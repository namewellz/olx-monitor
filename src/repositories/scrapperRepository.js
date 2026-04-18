const { query } = require('../database/database.js')
const $logger = require('../components/Logger.js')

const saveLog = async (data) => {
  $logger.debug('scrapperRepository: saveLog')
  await query(
    `INSERT INTO logs (url, "adsFound", "averagePrice", "minPrice", "maxPrice", created)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [data.url, data.adsFound, data.averagePrice, data.minPrice, data.maxPrice, new Date().toISOString()]
  )
}

const getLogsByUrl = async (url, limit) => {
  $logger.debug('scrapperRepository: getLogsByUrl')
  const { rows } = await query(
    `SELECT * FROM logs WHERE url = $1 LIMIT $2`,
    [url, limit]
  )
  return rows
}

module.exports = { saveLog, getLogsByUrl }
