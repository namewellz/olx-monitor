/**
 * Migração automática SQLite → PostgreSQL
 *
 * Executado automaticamente na inicialização se:
 *   1. Existir arquivo SQLite em /usr/data/ads.db (ou SQLITE_PATH)
 *   2. A tabela ads no PostgreSQL estiver vazia
 *
 * Também pode ser executado manualmente:
 *   node migrate-sqlite-to-pg.js [caminho-do-sqlite]
 */

const fs = require('fs')
const path = require('path')
const { query } = require('./database/database')

const DEFAULT_SQLITE_PATH = '/usr/data/ads.db'

const sqliteAll = (db, sql) => new Promise((res, rej) =>
  db.all(sql, [], (err, rows) => err ? rej(err) : res(rows))
)

async function runMigration(sqlitePath, $logger) {
  const log = $logger || { info: console.log, warn: console.warn, error: console.error }

  const sqlite3 = require('sqlite3').verbose()
  const db = new sqlite3.Database(sqlitePath, sqlite3.OPEN_READONLY)
  const client = (await query('SELECT 1')).then ? null : null // force pool init

  // Usa pool compartilhado do database.js
  const { Pool } = require('pg')
  const pool = new Pool({
    host:     process.env.PGHOST     || 'localhost',
    port:     Number(process.env.PGPORT) || 5432,
    user:     process.env.PGUSER     || 'olxmonitor',
    password: process.env.PGPASSWORD || 'olxmonitor',
    database: process.env.PGDATABASE || 'olxmonitor',
  })

  const pgClient = await pool.connect()

  try {
    const [ads, logs] = await Promise.all([
      sqliteAll(db, 'SELECT * FROM ads'),
      sqliteAll(db, 'SELECT * FROM logs').catch(() => []),
    ])

    log.info(`[migration] SQLite: ${ads.length} anúncios, ${logs.length} logs`)

    await pgClient.query('BEGIN')

    let adsOk = 0
    for (const ad of ads) {
      await pgClient.query(
        `INSERT INTO ads (id, source, "searchTerm", title, price, url, notified, created, "lastUpdate")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (id, source) DO NOTHING`,
        [ad.id, ad.source || 'olx', ad.searchTerm, ad.title, ad.price,
         ad.url, ad.notified ?? 0, ad.created, ad.lastUpdate]
      )
      adsOk++
    }

    for (const log2 of logs) {
      await pgClient.query(
        `INSERT INTO logs (url, "adsFound", "averagePrice", "minPrice", "maxPrice", created)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [log2.url, log2.adsFound, log2.averagePrice, log2.minPrice, log2.maxPrice, log2.created]
      )
    }

    await pgClient.query('COMMIT')
    log.info(`[migration] Concluída: ${adsOk} anúncios e ${logs.length} logs migrados`)

  } catch (err) {
    await pgClient.query('ROLLBACK')
    log.error(`[migration] Falha — rollback efetuado: ${err.message}`)
    throw err
  } finally {
    pgClient.release()
    db.close()
    await pool.end()
  }
}

/**
 * Verifica se a migração automática deve rodar e executa se necessário.
 * Condições: arquivo SQLite existe + tabela ads no PG está vazia.
 */
async function autoMigrate($logger) {
  const sqlitePath = process.env.SQLITE_PATH || DEFAULT_SQLITE_PATH
  const log = $logger || { info: console.log, warn: console.warn, error: console.error }

  if (!fs.existsSync(sqlitePath)) return

  const { rows } = await query('SELECT COUNT(*) AS n FROM ads')
  if (Number(rows[0].n) > 0) {
    log.info('[migration] PostgreSQL já contém dados — migração automática ignorada')
    return
  }

  log.info(`[migration] Banco SQLite encontrado em ${sqlitePath} — iniciando migração automática...`)
  await runMigration(sqlitePath, log)
}

module.exports = { autoMigrate, runMigration }

// Execução manual via CLI
if (require.main === module) {
  const sqlitePath = process.argv[2] || DEFAULT_SQLITE_PATH
  if (!fs.existsSync(sqlitePath)) {
    console.error(`Arquivo não encontrado: ${sqlitePath}`)
    process.exit(1)
  }
  runMigration(sqlitePath).catch(() => process.exit(1))
}
