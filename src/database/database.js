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

// Migração para bancos existentes
const runMigrations = async () => {
  const migrations = [
    `ALTER TABLE ads ADD COLUMN notified INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE ads ADD COLUMN source TEXT NOT NULL DEFAULT 'olx'`,
  ]
  for (const sql of migrations) {
    await new Promise((resolve) => {
      db.run(sql, () => resolve(true)) // ignora erro se coluna já existe
    })
  }
}

module.exports = { db, createTables, runMigrations}