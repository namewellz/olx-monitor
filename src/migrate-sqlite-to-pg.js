/**
 * Migração única: SQLite → PostgreSQL
 * Uso: node migrate-sqlite-to-pg.js [caminho-do-sqlite]
 *
 * Exemplos:
 *   node migrate-sqlite-to-pg.js ../data/ads.db
 *   PGHOST=localhost PGUSER=olxmonitor ... node migrate-sqlite-to-pg.js ../data/ads.db
 */

require('dotenv').config()
const path = require('path')
const sqlite3 = require('sqlite3').verbose()
const { Pool } = require('pg')

const SQLITE_PATH = process.argv[2] || path.join(__dirname, '../data/ads.db')

const pool = new Pool({
  host:     process.env.PGHOST     || 'localhost',
  port:     Number(process.env.PGPORT) || 5432,
  user:     process.env.PGUSER     || 'olxmonitor',
  password: process.env.PGPASSWORD || 'olxmonitor',
  database: process.env.PGDATABASE || 'olxmonitor',
})

const sqliteAll = (db, sql) => new Promise((res, rej) =>
  db.all(sql, [], (err, rows) => err ? rej(err) : res(rows))
)

async function migrate() {
  console.log(`\n📦 Fonte SQLite : ${SQLITE_PATH}`)
  console.log(`🐘 Destino PG   : ${process.env.PGHOST || 'localhost'}:${process.env.PGPORT || 5432}/${process.env.PGDATABASE || 'olxmonitor'}\n`)

  const db = new sqlite3.Database(SQLITE_PATH, sqlite3.OPEN_READONLY)
  const client = await pool.connect()

  try {
    const [ads, logs] = await Promise.all([
      sqliteAll(db, 'SELECT * FROM ads'),
      sqliteAll(db, 'SELECT * FROM logs'),
    ])

    console.log(`📋 Anúncios encontrados : ${ads.length}`)
    console.log(`📋 Logs encontrados     : ${logs.length}\n`)

    await client.query('BEGIN')

    // ── Migrar ads ────────────────────────────────────────
    let adsOk = 0, adsSkip = 0
    for (const ad of ads) {
      try {
        await client.query(
          `INSERT INTO ads (id, source, "searchTerm", title, price, url, notified, created, "lastUpdate")
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           ON CONFLICT (id, source) DO NOTHING`,
          [ad.id, ad.source || 'olx', ad.searchTerm, ad.title, ad.price,
           ad.url, ad.notified ?? 0, ad.created, ad.lastUpdate]
        )
        adsOk++
      } catch (e) {
        console.warn(`  ⚠ Ad ${ad.id} skipped: ${e.message}`)
        adsSkip++
      }
    }

    // ── Migrar logs ───────────────────────────────────────
    let logsOk = 0, logsSkip = 0
    for (const log of logs) {
      try {
        await client.query(
          `INSERT INTO logs (url, "adsFound", "averagePrice", "minPrice", "maxPrice", created)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [log.url, log.adsFound, log.averagePrice, log.minPrice, log.maxPrice, log.created]
        )
        logsOk++
      } catch (e) {
        console.warn(`  ⚠ Log ${log.id} skipped: ${e.message}`)
        logsSkip++
      }
    }

    await client.query('COMMIT')

    console.log(`✅ Ads   : ${adsOk} migrados${adsSkip ? `, ${adsSkip} ignorados` : ''}`)
    console.log(`✅ Logs  : ${logsOk} migrados${logsSkip ? `, ${logsSkip} ignorados` : ''}`)
    console.log('\n✨ Migração concluída com sucesso!\n')

  } catch (err) {
    await client.query('ROLLBACK')
    console.error('\n❌ Erro — rollback efetuado:', err.message)
    process.exit(1)
  } finally {
    client.release()
    db.close()
    await pool.end()
  }
}

migrate()
