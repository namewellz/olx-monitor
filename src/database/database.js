const { Pool } = require('pg')

const pool = new Pool({
  host:     process.env.PGHOST     || 'localhost',
  port:     Number(process.env.PGPORT) || 5432,
  user:     process.env.PGUSER     || 'olxmonitor',
  password: process.env.PGPASSWORD || 'olxmonitor',
  database: process.env.PGDATABASE || 'olxmonitor',
})

const query = (sql, params = []) => pool.query(sql, params)

const createTables = async () => {
  await query(`
    CREATE TABLE IF NOT EXISTS ads (
      id            BIGINT       NOT NULL,
      source        TEXT         NOT NULL DEFAULT 'olx',
      "searchTerm"  TEXT         NOT NULL,
      title         TEXT         NOT NULL,
      price         INTEGER      NOT NULL,
      url           TEXT         NOT NULL,
      notified      INTEGER      NOT NULL DEFAULT 0,
      created       TEXT         NOT NULL,
      "lastUpdate"  TEXT         NOT NULL,
      PRIMARY KEY (id, source)
    )
  `)

  await query(`
    CREATE TABLE IF NOT EXISTS logs (
      id              SERIAL   PRIMARY KEY,
      url             TEXT     NOT NULL,
      "adsFound"      INTEGER  NOT NULL,
      "averagePrice"  NUMERIC  NOT NULL,
      "minPrice"      NUMERIC  NOT NULL,
      "maxPrice"      NUMERIC  NOT NULL,
      created         TEXT     NOT NULL
    )
  `)

  await query(`
    CREATE TABLE IF NOT EXISTS search_urls (
      id      SERIAL  PRIMARY KEY,
      source  TEXT    NOT NULL DEFAULT 'olx',
      label   TEXT    NOT NULL DEFAULT '',
      url     TEXT    NOT NULL,
      active  INTEGER NOT NULL DEFAULT 1
    )
  `)
}

// PostgreSQL suporta ADD COLUMN IF NOT EXISTS — migrações são idempotentes
const runMigrations = async () => {
  await query(`ALTER TABLE ads ADD COLUMN IF NOT EXISTS notified INTEGER NOT NULL DEFAULT 0`)
  await query(`ALTER TABLE ads ADD COLUMN IF NOT EXISTS source   TEXT    NOT NULL DEFAULT 'olx'`)
}

module.exports = { query, createTables, runMigrations }
