// Inicia apenas o servidor da UI — sem scraper, sem notificações
require('dotenv').config()
const { createTables, runMigrations } = require('./database/database')
const { startServer } = require('./api/server')
const $logger = require('./components/Logger')

const main = async () => {
  $logger.info('Iniciando servidor UI (modo visualização)...')
  await createTables()
  await runMigrations()
  startServer(3000)
}

main().catch(console.error)
