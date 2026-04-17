const config = require("./config")
const cron = require("node-cron")
const { initializeCycleTLS } = require("./components/CycleTls")
const $logger = require("./components/Logger")
const { scraper } = require("./components/Scraper")
const { createTables, runMigrations } = require("./database/database.js")
const { processPendingNotifications } = require("./components/Notifier")


const runScraper = async () => {

  for (let i = 0; i < config.urls.length; i++) {
    try {
      scraper(config.urls[i])
    } catch (error) {
      $logger.error(error)
    }
  }
      // após scraping, processa qualquer notificação pendente
    //await processPendingNotifications()
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
