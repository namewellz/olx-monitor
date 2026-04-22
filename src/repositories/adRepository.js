const { query } = require('../database/database.js')
const $logger = require('../components/Logger.js')

const getAd = async (id, source) => {
  $logger.debug('adRepository: getAd')
  const { rows } = await query(
    `SELECT * FROM ads WHERE id = $1 AND source = $2`,
    [id, source]
  )
  if (!rows[0]) throw new Error('No ad with this ID was found')
  return rows[0]
}

const getAdsBySearchTerm = async (term, limit) => {
  $logger.debug('adRepository: getAdsBySearchTerm')
  const { rows } = await query(
    `SELECT * FROM ads WHERE "searchTerm" = $1 LIMIT $2`,
    [term, limit]
  )
  return rows
}

const getAdsBySearchId = async (id, limit) => {
  $logger.debug('adRepository: getAdsBySearchId')
  const { rows } = await query(
    `SELECT * FROM ads WHERE "searchId" = $1 LIMIT $2`,
    [id, limit]
  )
  return rows
}

const createAd = async (ad) => {
  $logger.debug('adRepository: createAd')
  const now = new Date().toISOString()
  await query(
    `INSERT INTO ads (id, source, url, title, "searchTerm", price, description, created, "lastUpdate", hash_indexed)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, FALSE)
     ON CONFLICT (id, source) DO NOTHING`,
    [ad.id, ad.source, ad.url, ad.title, ad.searchTerm, ad.price, ad.description || null, now, now]
  )
}

const updateAd = async (ad) => {
  $logger.debug('adRepository: updateAd')
  await query(
    `UPDATE ads SET price = $1, "lastUpdate" = $2 WHERE id = $3 AND source = $4`,
    [ad.price, new Date().toISOString(), ad.id, ad.source]
  )
}

const getPendingNotifications = async () => {
  // hash_indexed = TRUE garante que o indexer já rodou antes de notificar
  const { rows } = await query(
    `SELECT * FROM ads WHERE notified = 0 AND hash_indexed = TRUE`
  )
  return rows
}

const markAsNotified = async (id, source) => {
  await query(
    `UPDATE ads SET notified = 1, "lastUpdate" = $1 WHERE id = $2 AND source = $3`,
    [new Date().toISOString(), id, source]
  )
}

const upsertAdSearchUrl = async (adId, adSource, searchUrlId) => {
  await query(
    `INSERT INTO ad_search_urls (ad_id, ad_source, search_url_id, first_seen, last_seen, missing_count)
     VALUES ($1, $2, $3, NOW(), NOW(), 0)
     ON CONFLICT (ad_id, ad_source, search_url_id) DO UPDATE
       SET last_seen = NOW(), missing_count = 0`,
    [String(adId), adSource, searchUrlId]
  )
}

// Chamado ao fim de cada ciclo de scraping de uma search_url.
// Incrementa missing_count dos ads que não apareceram e fecha os que atingiram o limite.
const CLOSE_AFTER_MISSING = 3

const updateMissingAds = async (searchUrlId, seenAdIds) => {
  if (seenAdIds.length === 0) return

  const placeholders = seenAdIds.map((_, i) => `$${i + 2}`).join(',')
  await query(
    `UPDATE ad_search_urls
     SET missing_count = missing_count + 1
     WHERE search_url_id = $1
       AND ad_id NOT IN (${placeholders})`,
    [searchUrlId, ...seenAdIds]
  )

  // Fecha ads que desapareceram de TODAS as buscas que os encontravam
  await query(
    `UPDATE ads SET closed_at = NOW()
     WHERE closed_at IS NULL
       AND EXISTS (
         SELECT 1 FROM ad_search_urls
         WHERE ad_id    = ads.id::text
           AND ad_source = ads.source
           AND search_url_id = $1
           AND missing_count >= $2
       )
       AND NOT EXISTS (
         SELECT 1 FROM ad_search_urls
         WHERE ad_id    = ads.id::text
           AND ad_source = ads.source
           AND missing_count < $2
       )`,
    [searchUrlId, CLOSE_AFTER_MISSING]
  )
}

module.exports = {
  getAd,
  getAdsBySearchTerm,
  getAdsBySearchId,
  createAd,
  updateAd,
  getPendingNotifications,
  markAsNotified,
  upsertAdSearchUrl,
  updateMissingAds,
}
