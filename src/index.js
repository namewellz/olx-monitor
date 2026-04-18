const config = require("./config")
const cron = require("node-cron")
const { initializeCycleTLS } = require("./components/CycleTls")
const $logger = require("./components/Logger")
const { scraper: scraperOLX } = require("./components/ScraperOLX")
const { scraper: scraperZAP } = require("./components/ScraperZAP")
const { createTables, runMigrations } = require("./database/database.js")
const { processPendingNotifications } = require("./components/Notifier")


const runScraper = async () => {
  // config.urls é o nome antigo — mantido para compatibilidade com configs existentes
  const olxUrls = config.olxUrls || config.urls || []
  for (const url of olxUrls) {
    try { await scraperOLX(url) } catch (error) { $logger.error(error) }
  }
  for (const url of (config.zapUrls || [])) {
    try { await scraperZAP(url) } catch (error) { $logger.error(error) }
  }
}

const runNotifier = async () => {
    try {
        await processPendingNotifications()
    } catch (error) {
        $logger.error(error)
    }
}


// notificador roda a cada 1 minuto, independente do scraper
cron.schedule('* * * * *', () => {
    runNotifier()
})


const main = async () => {
  $logger.info("Program started")
  await createTables()
  await runMigrations()
  await initializeCycleTLS()
  runScraper()
}

main()

cron.schedule(config.interval, () => {
  runScraper()
})
