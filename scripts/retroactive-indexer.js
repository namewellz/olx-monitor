'use strict'
/**
 * Indexador Retroativo de Duplicatas
 *
 * Uso (a partir da raiz do projeto):
 *   node scripts/retroactive-indexer.js
 *
 * Variáveis de ambiente:
 *   Lidas do arquivo src/.env (ou do ambiente, se já exportadas)
 *   PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE
 *
 * O script opera em três fases:
 *   1. Hashing  — baixa imagens e calcula pHash para todos os anúncios
 *                 que ainda não têm entradas em ad_image_hashes
 *   2. Comparação — compara todos os pares de anúncios com preço ±20%
 *                   usando union-find para detectar grupos transitivos
 *   3. Persistência — grava group_id em cada anúncio do cluster
 */

const fs   = require('fs')
const path = require('path')
const srcDir = path.join(__dirname, '../src')

// Resolve dependências de src/node_modules sem precisar de install separado
require(path.join(srcDir, 'node_modules/dotenv')).config({ path: path.join(srcDir, '.env') })

// Módulos do projeto (os requires internos deles resolvem via src/node_modules)
const { initializeCycleTLS, exitCycleTLS, getCycleTLSInstance } = require(path.join(srcDir, 'components/CycleTls'))
const { hashAll }    = require(path.join(srcDir, 'components/Hasher'))
const { compare }    = require(path.join(srcDir, 'components/Comparator'))
const adapters       = require(path.join(srcDir, 'sources'))

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../data')

function saveImagesToDisk(ad, buffers) {
  const dir = path.join(DATA_DIR, 'images', ad.source, String(ad.id))
  fs.mkdirSync(dir, { recursive: true })
  for (let i = 0; i < buffers.length; i++) {
    const { url, buffer } = buffers[i]
    if (!buffer) continue
    const ext = (url.split('.').pop().split('?')[0] || 'jpg').slice(0, 5)
    fs.writeFileSync(path.join(dir, `img_${i + 1}.${ext}`), buffer)
  }
}

// Pool próprio para o script (não compartilha com o servidor)
const { Pool } = require(path.join(srcDir, 'node_modules/pg'))
const pool = new Pool({
  host:     process.env.PGHOST     || 'localhost',
  port:     Number(process.env.PGPORT) || 5432,
  user:     process.env.PGUSER     || 'olxmonitor',
  password: process.env.PGPASSWORD || 'olxmonitor',
  database: process.env.PGDATABASE || 'olxmonitor',
})
const q = (sql, params = []) => pool.query(sql, params)

// ── Configuração ────────────────────────────────────────────────
const PRICE_TOLERANCE = 0.20   // ±20% para considerar candidato
const GROUP_THRESHOLD = 0.70   // cobertura mínima para duplicata
const MAX_ATTEMPTS    = 3      // tentativas antes de desistir

// ── Log ─────────────────────────────────────────────────────────
function log(msg)  { console.log(`[${new Date().toISOString()}] ${msg}`) }
function warn(msg) { console.warn(`[${new Date().toISOString()}] WARN  ${msg}`) }

// ── Union-Find ──────────────────────────────────────────────────
function makeUnionFind(keys) {
  const parent = Object.fromEntries(keys.map(k => [k, k]))
  const rank   = Object.fromEntries(keys.map(k => [k, 0]))

  function find(x) {
    if (parent[x] !== x) parent[x] = find(parent[x])
    return parent[x]
  }

  function union(x, y) {
    const px = find(x), py = find(y)
    if (px === py) return
    if (rank[px] < rank[py]) { parent[px] = py }
    else if (rank[px] > rank[py]) { parent[py] = px }
    else { parent[py] = px; rank[px]++ }
  }

  return { find, union }
}

// ── Fase 1: Hashing ─────────────────────────────────────────────

const DELAY_MIN = 1200
const DELAY_MAX = 2500
const IMG_RETRIES = 3

function randomDelay() {
  return new Promise(r => setTimeout(r, DELAY_MIN + Math.random() * (DELAY_MAX - DELAY_MIN)))
}

async function downloadOne(cycleTLS, url, imgIndex, total) {
  for (let attempt = 1; attempt <= IMG_RETRIES; attempt++) {
    try {
      log(`    [img ${imgIndex}/${total}] GET ${url.slice(0, 80)}`)
      const response = await cycleTLS(url, {
        ja3: '771,4865-4867-4866-49195-49199-52393-52392-49196-49200-49162-49161-49171-49172-51-57-47-53,0-23-65281-10-11-35-16-5-51-43-13-45-28-21,29-23-24-25-256-257,0',
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        headers: { Accept: 'image/webp,image/apng,image/*,*/*;q=0.8', Referer: 'https://www.zapimoveis.com.br/' },
      }, 'GET')

      if (response.status === 200 && response.body) {
        const buf = Buffer.from(response.body, 'base64')
        log(`    [img ${imgIndex}/${total}] ✓ HTTP 200 — ${(buf.length / 1024).toFixed(1)} KB`)
        return buf
      }

      const msg = `HTTP ${response.status}`
      if (attempt < IMG_RETRIES) {
        warn(`    [img ${imgIndex}/${total}] ${msg} — retry ${attempt}/${IMG_RETRIES} em ${attempt * 3}s`)
        await new Promise(r => setTimeout(r, attempt * 3000))
      } else {
        warn(`    [img ${imgIndex}/${total}] ${msg} — desistindo após ${IMG_RETRIES} tentativas`)
      }
    } catch (err) {
      if (attempt < IMG_RETRIES) {
        warn(`    [img ${imgIndex}/${total}] erro: ${err.message} — retry ${attempt}/${IMG_RETRIES}`)
        await new Promise(r => setTimeout(r, attempt * 3000))
      } else {
        warn(`    [img ${imgIndex}/${total}] erro definitivo: ${err.message}`)
      }
    }
  }
  return null
}

async function hashAd(ad, adIndex, total) {
  const adapter = adapters[ad.source]
  if (!adapter) {
    warn(`[${adIndex}/${total}] Sem adaptador para source "${ad.source}" — ignorando anúncio ${ad.id}`)
    await q(`UPDATE ads SET hash_indexed = TRUE WHERE id = $1 AND source = $2`, [ad.id, ad.source])
    return 'no_adapter'
  }

  log(`[${adIndex}/${total}] Anúncio ${ad.id} [${ad.source}] — "${String(ad.title || '').slice(0, 60)}"`)
  log(`  URL: ${ad.url}`)

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (attempt > 1) log(`  Tentativa ${attempt}/${MAX_ATTEMPTS}...`)
    try {
      log(`  Extraindo imagens e descrição...`)
      const { imageUrls, description } = await adapter.extractAdData(ad)

      if (description) {
        await q(`UPDATE ads SET description = $1 WHERE id = $2 AND source = $3`, [description, ad.id, ad.source])
        log(`  Descrição salva (${description.length} chars)`)
      }

      if (imageUrls.length === 0) {
        warn(`  Nenhuma imagem encontrada — marcando como indexado`)
        await q(`UPDATE ads SET hash_indexed = TRUE WHERE id = $1 AND source = $2`, [ad.id, ad.source])
        return 'no_images'
      }

      log(`  ${imageUrls.length} imagem(ns) encontrada(s) — iniciando downloads...`)
      const cycleTLS = getCycleTLSInstance()
      const buffers  = []

      for (let i = 0; i < imageUrls.length; i++) {
        const buf = await downloadOne(cycleTLS, imageUrls[i], i + 1, imageUrls.length)
        buffers.push({ url: imageUrls[i], buffer: buf })
        if (i < imageUrls.length - 1) await randomDelay()
      }

      saveImagesToDisk(ad, buffers)
      log(`  Calculando pHash...`)
      const hashes = await hashAll(buffers)
      const valid  = hashes.filter(h => h.hash !== null)

      if (valid.length === 0) {
        if (attempt < MAX_ATTEMPTS) {
          warn(`  Todos os downloads falharam — tentativa ${attempt}/${MAX_ATTEMPTS}`)
          continue
        }
        warn(`  Desistindo após ${MAX_ATTEMPTS} tentativas`)
        await q(
          `UPDATE ads SET hash_indexed = TRUE, hash_attempts = $1 WHERE id = $2 AND source = $3`,
          [attempt, ad.id, ad.source]
        )
        return 'download_failed'
      }

      for (const { url, hash } of hashes) {
        if (!hash) continue
        await q(
          `INSERT INTO ad_image_hashes (ad_id, ad_source, image_url, phash)
           VALUES ($1, $2, $3, $4) ON CONFLICT (ad_id, ad_source, image_url) DO NOTHING`,
          [String(ad.id), ad.source, url, hash]
        )
      }
      await q(`UPDATE ads SET hash_indexed = TRUE WHERE id = $1 AND source = $2`, [ad.id, ad.source])

      log(`  ✓ ${valid.length}/${imageUrls.length} hashes persistidos`)
      return 'ok'

    } catch (err) {
      if (attempt < MAX_ATTEMPTS) {
        warn(`  Erro tentativa ${attempt}: ${err.message}`)
        continue
      }
      warn(`  Falha definitiva: ${err.message}`)
      await q(
        `UPDATE ads SET hash_indexed = TRUE, hash_attempts = $1 WHERE id = $2 AND source = $3`,
        [attempt, ad.id, ad.source]
      )
      return 'error'
    }
  }
  return 'error'
}

async function runHashingPhase() {
  log('━━━ FASE 1: Hashing de imagens ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')

  const { rows: unhashed } = await q(`
    SELECT a.id, a.source, a.url, a.price, a.title
    FROM ads a
    WHERE NOT EXISTS (
      SELECT 1 FROM ad_image_hashes h
      WHERE h.ad_id = a.id::text AND h.ad_source = a.source
    )
    ORDER BY a.created DESC
  `)

  log(`Anúncios sem hashes: ${unhashed.length}`)
  if (unhashed.length === 0) {
    log('Nenhum anúncio para processar — fase 1 ignorada.')
    return
  }

  const counts = { ok: 0, no_adapter: 0, no_images: 0, download_failed: 0, error: 0 }

  for (let i = 0; i < unhashed.length; i++) {
    const result = await hashAd(unhashed[i], i + 1, unhashed.length)
    counts[result] = (counts[result] || 0) + 1
  }

  console.log()
  log(`Fase 1 concluída — ok: ${counts.ok}, sem_imagens: ${counts.no_images}, ` +
      `download_falhou: ${counts.download_failed}, erro: ${counts.error}, ` +
      `sem_adaptador: ${counts.no_adapter}`)
}

// ── Fase 2: Comparação pairwise ─────────────────────────────────

async function runComparisonPhase() {
  log('━━━ FASE 2: Comparação pairwise ━━━━━━━━━━━━━━━━━━━━━━━━━━━━')

  // Carrega todos os anúncios que têm pelo menos um hash
  const { rows: ads } = await q(`
    SELECT DISTINCT a.id, a.source, a.price::numeric AS price, a.group_id
    FROM ads a
    JOIN ad_image_hashes h ON h.ad_id = a.id::text AND h.ad_source = a.source
    ORDER BY a.price::numeric ASC
  `)
  log(`Anúncios com hashes: ${ads.length}`)

  if (ads.length < 2) {
    log('Menos de 2 anúncios com hashes — comparação ignorada.')
    return
  }

  // Carrega todos os hashes em memória
  const { rows: allHashRows } = await q(
    `SELECT ad_id, ad_source, image_url AS url, phash AS hash FROM ad_image_hashes`
  )
  const hashMap = {}
  for (const h of allHashRows) {
    const key = `${h.ad_id}:${h.ad_source}`
    if (!hashMap[key]) hashMap[key] = []
    hashMap[key].push({ url: h.url, hash: h.hash })
  }

  // Union-Find para agrupamento transitivo
  const keys = ads.map(a => `${a.id}:${a.source}`)
  const uf   = makeUnionFind(keys)

  let pairsChecked = 0
  let duplicatesFound = 0

  for (let i = 0; i < ads.length; i++) {
    const a  = ads[i]
    const pa = Number(a.price) || 0
    if (pa === 0) continue

    const keyA   = `${a.id}:${a.source}`
    const hashesA = hashMap[keyA] || []
    if (hashesA.length === 0) continue

    for (let j = i + 1; j < ads.length; j++) {
      const b  = ads[j]
      const pb = Number(b.price) || 0
      if (pb === 0) continue

      // Filtro de preço simétrico: qualquer um dentro de ±20% do outro
      const withinTolerance =
        (pb >= pa * (1 - PRICE_TOLERANCE) && pb <= pa * (1 + PRICE_TOLERANCE)) ||
        (pa >= pb * (1 - PRICE_TOLERANCE) && pa <= pb * (1 + PRICE_TOLERANCE))

      if (!withinTolerance) {
        // Como ads estão ordenados por preço ASC, quando pb > pa*1.2
        // todos os próximos j também estarão fora — pode sair cedo
        if (pb > pa * (1 + PRICE_TOLERANCE)) break
        continue
      }

      const keyB   = `${b.id}:${b.source}`
      const hashesB = hashMap[keyB] || []
      if (hashesB.length === 0) continue

      pairsChecked++
      const result = compare(hashesA, hashesB)

      if (result.coverageSmaller >= GROUP_THRESHOLD) {
        uf.union(keyA, keyB)
        duplicatesFound++
      }
    }

    if ((i + 1) % 100 === 0 || i === ads.length - 1) {
      process.stdout.write(
        `\r[Fase 2] ${i + 1}/${ads.length} anúncios, ${pairsChecked} pares, ${duplicatesFound} duplicatas     `
      )
    }
  }

  console.log()
  log(`Fase 2 concluída — ${pairsChecked} pares verificados, ${duplicatesFound} relações de duplicata`)

  // ── Fase 3: Persistência dos grupos ─────────────────────────────
  log('━━━ FASE 3: Persistindo grupos ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')

  // Agrupa por raiz no union-find
  const clusters = {}
  for (const ad of ads) {
    const root = uf.find(`${ad.id}:${ad.source}`)
    if (!clusters[root]) clusters[root] = []
    clusters[root].push(ad)
  }

  const duplicateClusters = Object.values(clusters).filter(c => c.length > 1)
  log(`Clusters de duplicatas: ${duplicateClusters.length}`)

  let groupsCreated = 0, groupsMerged = 0, adsUpdated = 0

  for (const cluster of duplicateClusters) {
    // Verifica se algum ad no cluster já tem group_id
    const existingIds = [...new Set(cluster.map(a => a.group_id).filter(Boolean))]

    let groupId
    if (existingIds.length === 0) {
      // Nenhum grupo — cria novo
      const { rows } = await q(`INSERT INTO property_groups DEFAULT VALUES RETURNING id`)
      groupId = rows[0].id
      groupsCreated++
    } else {
      // Usa o menor id existente como grupo canônico (merge implícito)
      groupId = Math.min(...existingIds)
      if (existingIds.length > 1) groupsMerged++
    }

    for (const ad of cluster) {
      await q(
        `UPDATE ads SET group_id = $1, hash_indexed = TRUE WHERE id = $2 AND source = $3`,
        [groupId, ad.id, ad.source]
      )
      adsUpdated++
    }
  }

  // Garante que todos os anúncios sem grupo também estão marcados como indexados
  const { rowCount } = await q(`
    UPDATE ads SET hash_indexed = TRUE
    WHERE hash_indexed = FALSE
      AND EXISTS (
        SELECT 1 FROM ad_image_hashes
        WHERE ad_id = ads.id::text AND ad_source = ads.source
      )
  `)
  if (rowCount > 0) log(`${rowCount} anúncio(s) adicionais marcados como indexados`)

  log(`Fase 3 concluída — grupos criados: ${groupsCreated}, merges: ${groupsMerged}, ` +
      `anúncios atualizados: ${adsUpdated}`)
}

// ── Resumo final ────────────────────────────────────────────────

async function printSummary() {
  const { rows: [totals] } = await q(`
    SELECT
      COUNT(*)                                        AS total_ads,
      COUNT(*) FILTER (WHERE hash_indexed = TRUE)     AS indexed,
      COUNT(*) FILTER (WHERE group_id IS NOT NULL)    AS in_group,
      COUNT(DISTINCT group_id) FILTER (WHERE group_id IS NOT NULL) AS groups
    FROM ads
  `)
  const { rows: [hashCount] } = await q(`SELECT COUNT(*) AS n FROM ad_image_hashes`)

  log('━━━ RESUMO ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  log(`Anúncios totais   : ${totals.total_ads}`)
  log(`Indexados         : ${totals.indexed}`)
  log(`Com grupo         : ${totals.in_group}`)
  log(`Grupos distintos  : ${totals.groups}`)
  log(`Total de hashes   : ${hashCount.n}`)
}

// ── Entry point ─────────────────────────────────────────────────

async function main() {
  log('━━━ INDEXADOR RETROATIVO DE DUPLICATAS ━━━━━━━━━━━━━━━━━━━━━')

  try {
    await q('SELECT 1')
    log('Banco de dados conectado.')
  } catch (err) {
    console.error(`ERRO: Não foi possível conectar ao banco: ${err.message}`)
    process.exit(1)
  }

  log('Inicializando CycleTLS...')
  await initializeCycleTLS()
  log('CycleTLS pronto.')

  try {
    await runHashingPhase()
    await runComparisonPhase()
    await printSummary()
    log('Concluído com sucesso.')
  } catch (err) {
    console.error(`ERRO FATAL: ${err.message}`)
    console.error(err.stack)
    process.exit(1)
  } finally {
    try { exitCycleTLS() } catch {}
    await pool.end()
  }
}

main()
