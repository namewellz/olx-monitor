const config = require("./config")
const cron = require("node-cron")
const { initializeCycleTLS } = require("./components/CycleTls")
const $logger = require("./components/Logger")
const { scraper } = require("./components/Scraper")
const { scraper2 } = require("./components/Scraper2")
const { createTables, runMigrations } = require("./database/database.js")
const { processPendingNotifications } = require("./components/Notifier")


const runScraper = async () => {
  for (let i = 0; i < config.urls.length; i++) {
    try {
      await scraper(config.urls[i])
    } catch (error) {
      $logger.error(error)
    }
  }

  if (config.zapUrls && config.zapUrls.length) {
    for (let i = 0; i < config.zapUrls.length; i++) {
      try {
        await scraper2(config.zapUrls[i])
      } catch (error) {
        $logger.error(error)
      }
    }
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
