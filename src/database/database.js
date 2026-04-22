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

  // ── Detecção de duplicatas por pHash ──────────────────────────
  // Agrupa anúncios que representam o mesmo imóvel físico
  await query(`
    CREATE TABLE IF NOT EXISTS property_groups (
      id      SERIAL  PRIMARY KEY,
      created TEXT    NOT NULL DEFAULT to_char(NOW(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
    )
  `)

  // Hash perceptual de cada imagem de cada anúncio
  await query(`
    CREATE TABLE IF NOT EXISTS ad_image_hashes (
      id         SERIAL  PRIMARY KEY,
      ad_id      TEXT    NOT NULL,
      ad_source  TEXT    NOT NULL,
      image_url  TEXT    NOT NULL,
      phash      CHAR(64) NOT NULL,
      created    TEXT    NOT NULL DEFAULT to_char(NOW(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      UNIQUE (ad_id, ad_source, image_url)
    )
  `)
  await query(`CREATE INDEX IF NOT EXISTS idx_ad_image_hashes_ad ON ad_image_hashes (ad_id, ad_source)`)

  // Colunas adicionais em ads
  // DEFAULT TRUE: anúncios existentes são marcados como já indexados
  // Novos anúncios são inseridos explicitamente com hash_indexed = FALSE
  await query(`ALTER TABLE ads ADD COLUMN IF NOT EXISTS hash_indexed  BOOLEAN  NOT NULL DEFAULT TRUE`)
  await query(`ALTER TABLE ads ADD COLUMN IF NOT EXISTS hash_attempts SMALLINT NOT NULL DEFAULT 0`)
  await query(`ALTER TABLE ads ADD COLUMN IF NOT EXISTS group_id      INTEGER  REFERENCES property_groups(id)`)
  await query(`ALTER TABLE ads ADD COLUMN IF NOT EXISTS description   TEXT`)

  // ── Anunciantes ───────────────────────────────────────────────
  await query(`
    CREATE TABLE IF NOT EXISTS advertisers (
      id          SERIAL  PRIMARY KEY,
      source      TEXT    NOT NULL,
      external_id TEXT    NOT NULL,
      name        TEXT    NOT NULL,
      UNIQUE (source, external_id)
    )
  `)
  await query(`ALTER TABLE ads ADD COLUMN IF NOT EXISTS advertiser_id INTEGER REFERENCES advertisers(id)`)
  await query(`ALTER TABLE ads ADD COLUMN IF NOT EXISTS published_at  TEXT`)
  await query(`ALTER TABLE ads ADD COLUMN IF NOT EXISTS updated_at    TEXT`)

  // ── Rastreamento de encerramento ──────────────────────────────
  await query(`ALTER TABLE ads ADD COLUMN IF NOT EXISTS closed_at TIMESTAMP`)

  // Relaciona cada anúncio com as URLs de busca que o encontraram.
  // missing_count: ciclos consecutivos em que o ad não apareceu nessa busca.
  await query(`
    CREATE TABLE IF NOT EXISTS ad_search_urls (
      ad_id         TEXT    NOT NULL,
      ad_source     TEXT    NOT NULL,
      search_url_id INTEGER NOT NULL REFERENCES search_urls(id) ON DELETE CASCADE,
      first_seen    TIMESTAMP NOT NULL DEFAULT NOW(),
      last_seen     TIMESTAMP NOT NULL DEFAULT NOW(),
      missing_count INTEGER   NOT NULL DEFAULT 0,
      PRIMARY KEY (ad_id, ad_source, search_url_id)
    )
  `)
  await query(`CREATE INDEX IF NOT EXISTS idx_ad_search_urls_search ON ad_search_urls (search_url_id)`)
}

module.exports = { query, createTables, runMigrations }
