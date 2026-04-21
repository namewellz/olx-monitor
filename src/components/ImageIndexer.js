'use strict'
const fs                 = require('fs')
const path               = require('path')
const { query }          = require('../database/database')
const { downloadImages } = require('./ImageDownloader')
const { hashAll }        = require('./Hasher')
const { compare }        = require('./Comparator')
const $logger            = require('./Logger')
const adapters           = require('../sources')

const DATA_DIR = process.env.DATA_DIR || '/usr/data'

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

const PRICE_TOLERANCE = 0.20   // ±20% na busca de candidatos
const GROUP_THRESHOLD = 0.70   // cobertura mínima para considerar duplicata
const MAX_ATTEMPTS    = 3      // falhas antes de marcar indexed sem grupo
const BATCH_SIZE      = 5      // ads processados por ciclo do indexer

// ── Helpers ────────────────────────────────────────────────────

async function persistHashes(ad, hashes) {
  for (const { url, hash } of hashes) {
    if (!hash) continue
    await query(
      `INSERT INTO ad_image_hashes (ad_id, ad_source, image_url, phash)
       VALUES ($1, $2, $3, $4) ON CONFLICT (ad_id, ad_source, image_url) DO NOTHING`,
      [String(ad.id), ad.source, url, hash]
    )
  }
}

async function findDuplicateGroup(ad, validHashes) {
  const price = Number(ad.price) || 0
  if (price === 0 || validHashes.length === 0) return null

  // Busca candidatos por faixa de preço ±20%, qualquer source
  const { rows: candidates } = await query(
    `SELECT DISTINCT a.id, a.source, a.group_id
     FROM ads a
     JOIN ad_image_hashes h ON h.ad_id = a.id::text AND h.ad_source = a.source
     WHERE a.price BETWEEN $1 AND $2
       AND NOT (a.id = $3 AND a.source = $4)`,
    [
      Math.floor(price * (1 - PRICE_TOLERANCE)),
      Math.ceil(price  * (1 + PRICE_TOLERANCE)),
      ad.id, ad.source,
    ]
  )

  for (const candidate of candidates) {
    const { rows: hashRows } = await query(
      `SELECT phash AS hash, image_url AS url FROM ad_image_hashes
       WHERE ad_id = $1 AND ad_source = $2`,
      [String(candidate.id), candidate.source]
    )
    if (hashRows.length === 0) continue

    const result = compare(validHashes, hashRows)
    $logger.info(
      `[ImageIndexer] ${ad.id} vs ${candidate.id} [${candidate.source}]: ` +
      `${result.verdict} (${(result.coverageSmaller * 100).toFixed(0)}%)`
    )

    if (result.coverageSmaller >= GROUP_THRESHOLD) {
      return candidate.group_id
    }
  }

  return null
}

async function getOrCreateGroup(existingGroupId) {
  if (existingGroupId) return existingGroupId
  const { rows } = await query(`INSERT INTO property_groups DEFAULT VALUES RETURNING id`)
  return rows[0].id
}

async function markIndexed(ad, groupId) {
  await query(
    `UPDATE ads SET hash_indexed = TRUE, group_id = $1 WHERE id = $2 AND source = $3`,
    [groupId, ad.id, ad.source]
  )
}

async function handleFailure(ad) {
  const attempts = (ad.hash_attempts || 0) + 1
  if (attempts >= MAX_ATTEMPTS) {
    $logger.warn(`[ImageIndexer] Max attempts (${MAX_ATTEMPTS}) for ad ${ad.id} — marking indexed without group`)
    await query(
      `UPDATE ads SET hash_indexed = TRUE, hash_attempts = $1 WHERE id = $2 AND source = $3`,
      [attempts, ad.id, ad.source]
    )
  } else {
    $logger.warn(`[ImageIndexer] Attempt ${attempts}/${MAX_ATTEMPTS} failed for ad ${ad.id} — will retry`)
    await query(
      `UPDATE ads SET hash_attempts = $1 WHERE id = $2 AND source = $3`,
      [attempts, ad.id, ad.source]
    )
  }
}

// ── Core ────────────────────────────────────────────────────────

async function indexAd(ad) {
  const adapter = adapters[ad.source]

  // Source sem adaptador → notifica normalmente sem agrupamento
  if (!adapter) {
    $logger.warn(`[ImageIndexer] No adapter for source "${ad.source}" — skipping ad ${ad.id}`)
    await markIndexed(ad, await getOrCreateGroup(null))
    return
  }

  try {
    $logger.info(`[ImageIndexer] Indexing ad ${ad.id} [${ad.source}]`)

    // 1. Busca imagens e descrição na página do anúncio (uma única requisição)
    const { imageUrls, description } = await adapter.extractAdData(ad)

    if (description) {
      await query(`UPDATE ads SET description = $1 WHERE id = $2 AND source = $3`, [description, ad.id, ad.source])
      $logger.info(`[ImageIndexer] Description saved for ad ${ad.id}`)
    }

    if (imageUrls.length === 0) {
      $logger.warn(`[ImageIndexer] No images for ad ${ad.id} — indexing without group`)
      await markIndexed(ad, await getOrCreateGroup(null))
      return
    }

    // 2. Download das imagens + salva em disco + cálculo de pHash
    const buffers = await downloadImages(imageUrls)
    saveImagesToDisk(ad, buffers)
    const hashes  = await hashAll(buffers)
    const valid   = hashes.filter(h => h.hash !== null)

    if (valid.length === 0) {
      $logger.warn(`[ImageIndexer] All downloads failed for ad ${ad.id}`)
      await handleFailure(ad)
      return
    }

    // 3. Persiste hashes no banco
    await persistHashes(ad, hashes)
    $logger.info(`[ImageIndexer] Persisted ${valid.length}/${imageUrls.length} hashes for ad ${ad.id}`)

    // 4. Compara com candidatos (cross-source automaticamente)
    const groupId = await findDuplicateGroup(ad, valid)

    // 5. Cria ou reutiliza grupo de imóvel
    const finalGroup = await getOrCreateGroup(groupId)
    await markIndexed(ad, finalGroup)

    const status = groupId ? `joined group ${finalGroup} (duplicate)` : `new group ${finalGroup}`
    $logger.info(`[ImageIndexer] Ad ${ad.id} indexed — ${status}`)

  } catch (err) {
    $logger.error(`[ImageIndexer] Error on ad ${ad.id}: ${err.message}`)
    await handleFailure(ad)
  }
}

// ── Public ──────────────────────────────────────────────────────

async function runIndexer() {
  try {
    const { rows: pending } = await query(
      `SELECT * FROM ads WHERE hash_indexed = FALSE ORDER BY created DESC LIMIT $1`,
      [BATCH_SIZE]
    )
    if (pending.length === 0) return

    $logger.info(`[ImageIndexer] ${pending.length} ad(s) to index`)
    for (const ad of pending) await indexAd(ad)

  } catch (err) {
    $logger.error(`[ImageIndexer] runIndexer error: ${err.message}`)
  }
}

module.exports = { runIndexer }
