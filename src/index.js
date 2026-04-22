const config = require("./config")
const cron = require("node-cron")
const { initializeCycleTLS } = require("./components/CycleTls")
const $logger = require("./components/Logger")
const { scraper: scraperOLX } = require("./components/ScraperOLX")
const { scraper: scraperZAP } = require("./components/ScraperZAP")
const { createTables, runMigrations, query } = require("./database/database.js")
const { processPendingNotifications } = require("./components/Notifier")
const { runIndexer } = require("./components/ImageIndexer")
const { startServer } = require("./api/server")
// Migração única: popula search_urls com as URLs do config.js se a tabela estiver vazia
const seedUrlsFromConfig = async () => {
  const { rows } = await query('SELECT COUNT(*) AS n FROM search_urls')
  if (Number(rows[0].n) > 0) return

  const olxUrls = config.olxUrls || config.urls || []
  const zapUrls = config.zapUrls || []

  if (olxUrls.length === 0 && zapUrls.length === 0) return

  for (const url of olxUrls) {
    await query(
      `INSERT INTO search_urls (source, url, active) VALUES ($1, $2, 1)`,
      ['olx', url]
    )
  }
  for (const url of zapUrls) {
    await query(
      `INSERT INTO search_urls (source, url, active) VALUES ($1, $2, 1)`,
      ['zap', url]
    )
  }

  $logger.info(`[seed] ${olxUrls.length} URL(s) OLX e ${zapUrls.length} URL(s) ZAP importadas do config.js para o banco`)
}

const runScraper = async () => {
  const { rows: urls } = await query('SELECT * FROM search_urls WHERE active = 1')

  if (urls.length === 0) {
    $logger.warn('[scraper] Nenhuma URL ativa encontrada no banco. Adicione via interface em /urls')
    return
  }

  for (const row of urls) {
    try {
      if (row.source === 'olx')      await scraperOLX(row)
      else if (row.source === 'zap') await scraperZAP(row)
      else $logger.warn(`[scraper] Fonte desconhecida: ${row.source}`)
    } catch (error) {
      $logger.error(`[scraper] Erro em ${row.source} ${row.url}: ${error.message}`)
    }
  }

  // Processa imagens dos novos anúncios encontrados neste ciclo
  await runIndexer()
}

const runNotifier = async () => {
  try {
    await processPendingNotifications()
  } catch (error) {
    $logger.error(error)
  }
}

// notificador roda a cada 1 minuto, independente do scraper
cron.schedule('* * * * *', () => { runNotifier() })

const main = async () => {
  $logger.info("Program started")
  await createTables()
  await runMigrations()
  await seedUrlsFromConfig()
  await initializeCycleTLS()
  startServer(config.uiPort || 3000)
  runScraper()
}

main()

cron.schedule(config.interval, () => { runScraper() })
