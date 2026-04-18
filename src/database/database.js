const config = require('../config')
const sqlite = require("sqlite3").verbose()
const db = new sqlite.Database(config.dbFile)

const createTables = async () => {
  const queries = [
    `CREATE TABLE IF NOT EXISTS "ads" (
        "id"            INTEGER NOT NULL,
        "source"        TEXT NOT NULL DEFAULT 'olx',
        "searchTerm"    TEXT NOT NULL,
        "title"	        TEXT NOT NULL,
        "price"         INTEGER NOT NULL,
        "url"           TEXT NOT NULL,
        "notified"      INTEGER NOT NULL DEFAULT 0,
        "created"       TEXT NOT NULL,
        "lastUpdate"    TEXT NOT NULL,
        PRIMARY KEY("id", "source")
    );`,
    `CREATE TABLE IF NOT EXISTS "logs" (
        "id"            INTEGER NOT NULL UNIQUE,
        "url"           TEXT NOT NULL,  
        "adsFound"      INTEGER NOT NULL, 
        "averagePrice"  NUMERIC NOT NULL,
        "minPrice"      NUMERIC NOT NULL,
        "maxPrice"      NUMERIC NOT NULL, 
        "created"       TEXT NOT NULL,
        PRIMARY KEY("id" AUTOINCREMENT)
    );`
  ];

  return new Promise(function(resolve, reject) {
    const executeQuery = (index) => {
      if (index === queries.length) {
        resolve(true);
        return;
      }
      db.run(queries[index], function(error) {
        if (error) {
          reject(error);
          return;
        }
        executeQuery(index + 1);
      });
    };
    executeQuery(0);
  });
  
}

// Executa uma query ignorando erro (usado para ALTER TABLE idempotente)
const runSilent = (sql) => new Promise((resolve) => {
  db.run(sql, () => resolve(true))
})

// Verifica se a chave primária da tabela ads já é composta (id, source)
const hasPrimaryKeySource = () => new Promise((resolve) => {
  db.all(`PRAGMA table_info(ads)`, [], (err, rows) => {
    if (err || !rows) return resolve(false)
    // SQLite marca pk=1 e pk=2 para PKs compostas
    const pkCols = rows.filter(r => r.pk > 0).map(r => r.name)
    resolve(pkCols.includes('source'))
  })
})

// Migração para bancos existentes
const runMigrations = async () => {
  // Passo 1: garante que as colunas existem (idempotente)
  await runSilent(`ALTER TABLE ads ADD COLUMN notified INTEGER NOT NULL DEFAULT 0`)
  await runSilent(`ALTER TABLE ads ADD COLUMN source TEXT NOT NULL DEFAULT 'olx'`)

  // Passo 2: migra a chave primária para (id, source) se ainda for apenas (id)
  const pkOk = await hasPrimaryKeySource()
  if (!pkOk) {
    await new Promise((resolve, reject) => {
      db.serialize(() => {
        db.run(`BEGIN TRANSACTION`)
        db.run(`
          CREATE TABLE IF NOT EXISTS ads_migrated (
            "id"          INTEGER NOT NULL,
            "source"      TEXT NOT NULL DEFAULT 'olx',
            "searchTerm"  TEXT NOT NULL,
            "title"       TEXT NOT NULL,
            "price"       INTEGER NOT NULL,
            "url"         TEXT NOT NULL,
            "notified"    INTEGER NOT NULL DEFAULT 0,
            "created"     TEXT NOT NULL,
            "lastUpdate"  TEXT NOT NULL,
            PRIMARY KEY("id", "source")
          )
        `)
        db.run(`
          INSERT OR IGNORE INTO ads_migrated
            (id, source, searchTerm, title, price, url, notified, created, lastUpdate)
          SELECT
            id,
            COALESCE(source, 'olx'),
            searchTerm, title, price, url,
            COALESCE(notified, 0),
            created, lastUpdate
          FROM ads
        `)
        db.run(`DROP TABLE ads`)
        db.run(`ALTER TABLE ads_migrated RENAME TO ads`)
        db.run(`COMMIT`, (err) => {
          if (err) { db.run(`ROLLBACK`); reject(err) }
          else resolve(true)
        })
      })
    })
  }
}

module.exports = { db, createTables, runMigrations}