'use strict'
/**
 * Indexador Retroativo de Anunciantes e Datas
 *
 * Uso (a partir da raiz do projeto):
 *   node scripts/retroactive-advertisers.js
 *
 * Preenche, para todos os anúncios sem advertiser_id ou published_at,
 * os campos: advertiser_id, published_at, updated_at
 * e cria/reutiliza registros na tabela advertisers.
 *
 * Variáveis de ambiente: lidas de src/.env
 */

const path   = require('path')
const srcDir = path.join(__dirname, '../src')

require(path.join(srcDir, 'node_modules/dotenv')).config({ path: path.join(srcDir, '.env') })

const { initializeCycleTLS, exitCycleTLS } = require(path.join(srcDir, 'components/CycleTls'))
const adapters = require(path.join(srcDir, 'sources'))

const { Pool } = require(path.join(srcDir, 'node_modules/pg'))
const pool = new Pool({
  host:     process.env.PGHOST     || 'localhost',
  port:     Number(process.env.PGPORT) || 5432,
  user:     process.env.PGUSER     || 'olxmonitor',
  password: process.env.PGPASSWORD || 'olxmonitor',
  database: process.env.PGDATABASE || 'olxmonitor',
})
const q = (sql, params = []) => pool.query(sql, params)

const MAX_ATTEMPTS = 3
const DELAY_MS     = 1500

function log(msg)  { console.log(`[${new Date().toISOString()}] ${msg}`) }
function warn(msg) { console.warn(`[${new Date().toISOString()}] WARN  ${msg}`) }

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

async function processAd(ad, index, total) {
  const adapter = adapters[ad.source]
  if (!adapter) {
    warn(`[${index}/${total}] Sem adaptador para source "${ad.source}" — ignorando ${ad.id}`)
    return 'no_adapter'
  }

  log(`[${index}/${total}] ${ad.id} [${ad.source}] — ${String(ad.title || '').slice(0, 60)}`)

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const { advertiser, publishedAt, updatedAt } = await adapter.extractAdData(ad)

      if (!advertiser && !publishedAt && !updatedAt) {
        warn(`  Nenhum dado de anunciante encontrado`)
        return 'no_data'
      }

      let advertiserId = null
      if (advertiser?.name) {
        const { rows } = await q(
          `INSERT INTO advertisers (source, external_id, name)
           VALUES ($1, $2, $3)
           ON CONFLICT (source, external_id) DO UPDATE SET name = EXCLUDED.name
           RETURNING id`,
          [ad.source, advertiser.externalId, advertiser.name]
        )
        advertiserId = rows[0].id
        log(`  Anunciante: "${advertiser.name}" (id ${advertiserId})`)
      }

      await q(
        `UPDATE ads SET
           advertiser_id = COALESCE($1, advertiser_id),
           published_at  = COALESCE($2, published_at),
           updated_at    = COALESCE($3, updated_at)
         WHERE id = $4 AND source = $5`,
        [advertiserId, publishedAt ?? null, updatedAt ?? null, ad.id, ad.source]
      )

      if (publishedAt) log(`  Publicado em: ${publishedAt}`)
      if (updatedAt)   log(`  Atualizado em: ${updatedAt}`)
      return 'ok'

    } catch (err) {
      if (attempt < MAX_ATTEMPTS) {
        warn(`  Erro tentativa ${attempt}: ${err.message} — retry em ${attempt * 3}s`)
        await sleep(attempt * 3000)
      } else {
        warn(`  Falha definitiva: ${err.message}`)
        return 'error'
      }
    }
  }
  return 'error'
}

async function main() {
  log('━━━ INDEXADOR RETROATIVO DE ANUNCIANTES ━━━━━━━━━━━━━━━━━━━')

  try {
    await q('SELECT 1')
    log('Banco de dados conectado.')
  } catch (err) {
    console.error(`ERRO: Não foi possível conectar: ${err.message}`)
    process.exit(1)
  }

  // Anúncios sem advertiser_id ou sem published_at
  const { rows: pending } = await q(`
    SELECT id, source, url, title
    FROM ads
    WHERE advertiser_id IS NULL OR published_at IS NULL
    ORDER BY created DESC
  `)
  log(`Anúncios para processar: ${pending.length}`)

  if (pending.length === 0) {
    log('Nenhum anúncio pendente — concluído.')
    await pool.end()
    return
  }

  log('Inicializando CycleTLS...')
  await initializeCycleTLS()
  log('CycleTLS pronto.')

  const counts = { ok: 0, no_data: 0, no_adapter: 0, error: 0 }

  try {
    for (let i = 0; i < pending.length; i++) {
      const result = await processAd(pending[i], i + 1, pending.length)
      counts[result] = (counts[result] || 0) + 1
      if (i < pending.length - 1) await sleep(DELAY_MS)
    }
  } finally {
    try { exitCycleTLS() } catch {}
    await pool.end()
  }

  log('━━━ RESUMO ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  log(`ok: ${counts.ok} | sem_dados: ${counts.no_data} | sem_adaptador: ${counts.no_adapter} | erro: ${counts.error}`)

  const { rows: [totals] } = await new Pool({
    host: process.env.PGHOST || 'localhost', port: Number(process.env.PGPORT) || 5432,
    user: process.env.PGUSER || 'olxmonitor', password: process.env.PGPASSWORD || 'olxmonitor',
    database: process.env.PGDATABASE || 'olxmonitor',
  }).query(`
    SELECT
      COUNT(DISTINCT advertiser_id) FILTER (WHERE advertiser_id IS NOT NULL) AS advertisers,
      COUNT(*) FILTER (WHERE advertiser_id IS NOT NULL)                       AS ads_with_advertiser,
      COUNT(*) FILTER (WHERE published_at IS NOT NULL)                        AS ads_with_date
    FROM ads
  `).catch(() => [{ advertisers: '?', ads_with_advertiser: '?', ads_with_date: '?' }])

  log(`Anunciantes distintos : ${totals.advertisers}`)
  log(`Ads com anunciante    : ${totals.ads_with_advertiser}`)
  log(`Ads com data publicação: ${totals.ads_with_date}`)
}

main().catch(err => {
  console.error('ERRO FATAL:', err)
  process.exit(1)
})
