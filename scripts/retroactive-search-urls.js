'use strict'
/**
 * Vinculação Retroativa de Anúncios × URLs de Busca
 *
 * Uso (a partir da raiz do projeto):
 *   node scripts/retroactive-search-urls.js
 *
 * Para cada URL de busca ativa, executa o scraper uma vez.
 * O scraper registra em ad_search_urls quais anúncios existentes
 * ainda aparecem naquela busca (missing_count = 0).
 * Anúncios que não aparecerem em nenhuma busca ficam sem vínculo
 * e não serão afetados pelo mecanismo de encerramento automático.
 *
 * Variáveis de ambiente: lidas de src/.env
 */

const path   = require('path')
const srcDir = path.join(__dirname, '../src')

require(path.join(srcDir, 'node_modules/dotenv')).config({ path: path.join(srcDir, '.env') })

const { initializeCycleTLS, exitCycleTLS } = require(path.join(srcDir, 'components/CycleTls'))
const { scraper: scraperOLX } = require(path.join(srcDir, 'components/ScraperOLX'))
const { scraper: scraperZAP } = require(path.join(srcDir, 'components/ScraperZAP'))

const { Pool } = require(path.join(srcDir, 'node_modules/pg'))
const pool = new Pool({
  host:     process.env.PGHOST     || 'localhost',
  port:     Number(process.env.PGPORT) || 5432,
  user:     process.env.PGUSER     || 'olxmonitor',
  password: process.env.PGPASSWORD || 'olxmonitor',
  database: process.env.PGDATABASE || 'olxmonitor',
})

function log(msg)  { console.log(`[${new Date().toISOString()}] ${msg}`) }
function warn(msg) { console.warn(`[${new Date().toISOString()}] WARN  ${msg}`) }

async function main() {
  log('━━━ VINCULAÇÃO RETROATIVA DE ANÚNCIOS × URLS DE BUSCA ━━━━━━')

  try {
    await pool.query('SELECT 1')
    log('Banco de dados conectado.')
  } catch (err) {
    console.error(`ERRO: Não foi possível conectar: ${err.message}`)
    process.exit(1)
  }

  const { rows: urls } = await pool.query(
    `SELECT * FROM search_urls WHERE active = 1 ORDER BY source, id`
  )
  log(`URLs de busca ativas: ${urls.length}`)

  if (urls.length === 0) {
    log('Nenhuma URL ativa — concluído.')
    await pool.end()
    return
  }

  log('Inicializando CycleTLS...')
  await initializeCycleTLS()
  log('CycleTLS pronto.')

  const counts = { olx: 0, zap: 0, error: 0 }

  try {
    for (const row of urls) {
      log(`[${row.source.toUpperCase()}] Processando: ${row.url.slice(0, 80)}...`)
      try {
        if (row.source === 'olx')      await scraperOLX(row)
        else if (row.source === 'zap') await scraperZAP(row)
        else { warn(`Fonte desconhecida: ${row.source} — ignorando`); continue }
        counts[row.source] = (counts[row.source] || 0) + 1
      } catch (err) {
        warn(`Erro em ${row.source} ${row.url}: ${err.message}`)
        counts.error++
      }
    }
  } finally {
    try { exitCycleTLS() } catch {}
    await pool.end()
  }

  log('━━━ RESUMO ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  log(`OLX: ${counts.olx} | ZAP: ${counts.zap} | Erros: ${counts.error}`)

  const { rows: [totals] } = await new Pool({
    host: process.env.PGHOST || 'localhost', port: Number(process.env.PGPORT) || 5432,
    user: process.env.PGUSER || 'olxmonitor', password: process.env.PGPASSWORD || 'olxmonitor',
    database: process.env.PGDATABASE || 'olxmonitor',
  }).query(`
    SELECT
      COUNT(DISTINCT (ad_id, ad_source))            AS ads_vinculados,
      COUNT(DISTINCT search_url_id)                  AS urls_com_vinculos,
      COUNT(*) FILTER (WHERE missing_count = 0)      AS associacoes_ativas
    FROM ad_search_urls
  `).catch(() => [{ ads_vinculados: '?', urls_com_vinculos: '?', associacoes_ativas: '?' }])

  log(`Anúncios vinculados  : ${totals.ads_vinculados}`)
  log(`URLs com vínculos    : ${totals.urls_com_vinculos}`)
  log(`Associações ativas   : ${totals.associacoes_ativas}`)
}

main().catch(err => {
  console.error('ERRO FATAL:', err)
  process.exit(1)
})
