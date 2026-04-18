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
    `INSERT INTO ads (id, source, url, title, "searchTerm", price, created, "lastUpdate")
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (id, source) DO NOTHING`,
    [ad.id, ad.source, ad.url, ad.title, ad.searchTerm, ad.price, now, now]
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
  const { rows } = await query(`SELECT * FROM ads WHERE notified = 0`)
  return rows
}

const markAsNotified = async (id, source) => {
  await query(
    `UPDATE ads SET notified = 1, "lastUpdate" = $1 WHERE id = $2 AND source = $3`,
    [new Date().toISOString(), id, source]
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
}
