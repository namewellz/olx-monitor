const path = require('path')
const fs = require('fs')
const express = require('express')
const multer = require('multer')
const { query, createTables } = require('../database/database')
const config = require('../config')

const app = express()
app.use(express.json())
app.use(express.static(path.join(__dirname, '../ui')))

const upload = multer({ dest: '/tmp/olx-monitor-uploads/' })

// ── Helpers ────────────────────────────────────────────────────
const dbAll = (sql, params) => query(sql, params).then(r => r.rows)
const dbGet = (sql, params) => query(sql, params).then(r => r.rows[0])
const dbRun = (sql, params) => query(sql, params).then(() => true)

// ── Stats ──────────────────────────────────────────────────────
app.get('/api/stats', async (req, res) => {
  try {
    const [total, pending, notified, olx, zap, activeUrls, dupGroups, indexPending] = await Promise.all([
      dbGet(`SELECT COUNT(*) AS n FROM ads`),
      dbGet(`SELECT COUNT(*) AS n FROM ads WHERE notified = 0`),
      dbGet(`SELECT COUNT(*) AS n FROM ads WHERE notified = 1`),
      dbGet(`SELECT COUNT(*) AS n FROM ads WHERE source = 'olx'`),
      dbGet(`SELECT COUNT(*) AS n FROM ads WHERE source = 'zap'`),
      dbGet(`SELECT COUNT(*) AS n FROM search_urls WHERE active = 1`).catch(() => ({ n: 0 })),
      dbGet(`SELECT COUNT(*) AS n FROM property_groups pg WHERE (SELECT COUNT(*) FROM ads WHERE group_id = pg.id) > 1`).catch(() => ({ n: 0 })),
      dbGet(`SELECT COUNT(*) AS n FROM ads WHERE hash_indexed = FALSE`).catch(() => ({ n: 0 })),
    ])
    res.json({
      total:        Number(total.n),
      pending:      Number(pending.n),
      notified:     Number(notified.n),
      olxCount:     Number(olx.n),
      zapCount:     Number(zap.n),
      activeUrls:   Number(activeUrls.n),
      dupGroups:    Number(dupGroups.n),
      indexPending: Number(indexPending.n),
    })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// ── Status ─────────────────────────────────────────────────────
app.get('/api/status', async (req, res) => {
  res.json({
    running:  true,
    interval: config.interval || '*/5 * * * *',
    nextRun:  '–',
    telegram: !!(process.env.TELEGRAM_TOKEN),
  })
})

// ── Ads ────────────────────────────────────────────────────────
app.get('/api/ads', async (req, res) => {
  try {
    const { source, notified, limit = 50, order = 'desc' } = req.query
    const params = []
    let where = 'WHERE 1=1'
    if (source)             { params.push(source);         where += ` AND source = $${params.length}` }
    if (notified !== undefined && notified !== '') {
      params.push(Number(notified)); where += ` AND notified = $${params.length}`
    }
    params.push(Number(limit))
    const sql = `SELECT * FROM ads ${where} ORDER BY created ${order === 'desc' ? 'DESC' : 'ASC'} LIMIT $${params.length}`
    res.json(await dbAll(sql, params))
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// ── Logs ───────────────────────────────────────────────────────
app.get('/api/logs', async (req, res) => {
  try {
    const { limit = 50, order = 'desc' } = req.query
    res.json(await dbAll(
      `SELECT * FROM logs ORDER BY created ${order === 'desc' ? 'DESC' : 'ASC'} LIMIT $1`,
      [Number(limit)]
    ))
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// ── URLs ───────────────────────────────────────────────────────
app.get('/api/urls', async (req, res) => {
  try {
    res.json(await dbAll(`SELECT * FROM search_urls ORDER BY source, label`))
  } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/urls', async (req, res) => {
  try {
    const { source = 'olx', label = '', url, active = true } = req.body
    if (!url) return res.status(400).json({ error: 'url required' })
    await dbRun(
      `INSERT INTO search_urls (source, label, url, active) VALUES ($1, $2, $3, $4)`,
      [source, label, url, active ? 1 : 0]
    )
    res.json({ ok: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

app.put('/api/urls/:id', async (req, res) => {
  try {
    const { source, label = '', url, active } = req.body
    await dbRun(
      `UPDATE search_urls SET source = $1, label = $2, url = $3, active = $4 WHERE id = $5`,
      [source, label, url, active ? 1 : 0, req.params.id]
    )
    res.json({ ok: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

app.delete('/api/urls/:id', async (req, res) => {
  try {
    await dbRun(`DELETE FROM search_urls WHERE id = $1`, [req.params.id])
    res.json({ ok: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// ── Settings ───────────────────────────────────────────────────
app.get('/api/settings', async (req, res) => {
  const token = process.env.TELEGRAM_TOKEN || ''
  res.json({
    interval:         config.interval || '*/5 * * * *',
    notifyOnFirstRun: !!config.notifyOnFirstRun,
    telegramToken:    token ? '***' : '',
    telegramChatId:   process.env.TELEGRAM_CHAT_ID    || '',
    telegramChatIdZap:process.env.TELEGRAM_CHAT_ID_ZAP|| '',
    telegramTokenOk:  !!token,
  })
})

app.put('/api/settings', async (req, res) => {
  res.json({ ok: true, note: 'Settings applied in-memory. Restart to persist.' })
})

// ── Telegram test ──────────────────────────────────────────────
app.post('/api/telegram/test', async (req, res) => {
  try {
    const { sendNotification } = require('../components/Notifier')
    await sendNotification('🔔 *OLX Monitor* — teste de conexão bem-sucedido!', 0, 'test')
    res.json({ ok: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// ── Run now ────────────────────────────────────────────────────
app.post('/api/run', async (req, res) => {
  try {
    const { scraper: scraperOLX } = require('../components/ScraperOLX')
    const { scraper: scraperZAP } = require('../components/ScraperZAP')
    const urls = await dbAll(`SELECT * FROM search_urls WHERE active = 1`)
    for (const row of urls) {
      if (row.source === 'olx')      scraperOLX(row.url).catch(() => {})
      else if (row.source === 'zap') scraperZAP(row.url).catch(() => {})
    }
  } catch {}
  res.json({ ok: true })
})

// ── Backup (JSON completo) ─────────────────────────────────────
app.get('/api/backup', async (req, res) => {
  try {
    const [ads, urls, logs, groups, hashes, advertisers] = await Promise.all([
      dbAll(`SELECT * FROM ads ORDER BY created`),
      dbAll(`SELECT * FROM search_urls ORDER BY source, label`),
      dbAll(`SELECT * FROM logs ORDER BY created`),
      dbAll(`SELECT * FROM property_groups ORDER BY id`).catch(() => []),
      dbAll(`SELECT * FROM ad_image_hashes ORDER BY id`).catch(() => []),
      dbAll(`SELECT * FROM advertisers ORDER BY id`).catch(() => []),
    ])
    const backup = {
      version:          '2.1',
      exportedAt:       new Date().toISOString(),
      ads,
      search_urls:      urls,
      logs,
      property_groups:  groups,
      ad_image_hashes:  hashes,
      advertisers,
    }
    res.setHeader('Content-Disposition', `attachment; filename="olx-monitor-backup-${new Date().toISOString().slice(0,10)}.json"`)
    res.setHeader('Content-Type', 'application/json')
    res.send(JSON.stringify(backup, null, 2))
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// ── Restore (streaming, sem limite de tamanho) ────────────────
app.post('/api/restore', upload.single('backup'), async (req, res) => {
  const filePath = req.file?.path
  if (!filePath) return res.status(400).json({ error: 'Nenhum arquivo enviado' })
  const BATCH = 200
  let adsOk = 0, urlsOk = 0, logsOk = 0, groupsOk = 0, hashesOk = 0, advertisersOk = 0
  const { Pool } = require('pg')
  const pool = new Pool({
    host: process.env.PGHOST || 'localhost', port: Number(process.env.PGPORT) || 5432,
    user: process.env.PGUSER || 'olxmonitor', password: process.env.PGPASSWORD || 'olxmonitor',
    database: process.env.PGDATABASE || 'olxmonitor',
  })
  try {
    const raw = fs.readFileSync(filePath, 'utf8')
    const { ads = [], search_urls = [], logs = [], property_groups = [], ad_image_hashes = [], advertisers = [] } = JSON.parse(raw)
    const pg = await pool.connect()
    try {
      // 1. advertisers — deve vir antes de ads (FK advertiser_id)
      for (let i = 0; i < advertisers.length; i += BATCH) {
        const batch = advertisers.slice(i, i + BATCH)
        await pg.query('BEGIN')
        for (const a of batch) {
          await pg.query(
            `INSERT INTO advertisers (id, source, external_id, name)
             VALUES ($1, $2, $3, $4) ON CONFLICT (source, external_id) DO UPDATE SET name = EXCLUDED.name`,
            [a.id, a.source, a.external_id, a.name]
          )
          advertisersOk++
        }
        await pg.query('COMMIT')
      }
      if (advertisers.length > 0) {
        await pg.query(`SELECT setval('advertisers_id_seq', COALESCE((SELECT MAX(id) FROM advertisers), 1))`)
      }

      // 2. property_groups — deve vir antes de ads (FK group_id)
      for (let i = 0; i < property_groups.length; i += BATCH) {
        const batch = property_groups.slice(i, i + BATCH)
        await pg.query('BEGIN')
        for (const g of batch) {
          await pg.query(
            `INSERT INTO property_groups (id, created) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`,
            [g.id, g.created]
          )
          groupsOk++
        }
        await pg.query('COMMIT')
      }
      // Reajusta a sequence para evitar conflito em novos inserts
      if (property_groups.length > 0) {
        await pg.query(`SELECT setval('property_groups_id_seq', COALESCE((SELECT MAX(id) FROM property_groups), 1))`)
      }

      // 2. ads (inclui colunas de pHash se presentes)
      for (let i = 0; i < ads.length; i += BATCH) {
        const batch = ads.slice(i, i + BATCH)
        await pg.query('BEGIN')
        for (const ad of batch) {
          await pg.query(
            `INSERT INTO ads (id, source, "searchTerm", title, price, url, notified, created, "lastUpdate",
                              hash_indexed, hash_attempts, group_id, description,
                              advertiser_id, published_at, updated_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
             ON CONFLICT (id, source) DO UPDATE SET
               hash_indexed  = EXCLUDED.hash_indexed,
               hash_attempts = EXCLUDED.hash_attempts,
               group_id      = COALESCE(EXCLUDED.group_id,      ads.group_id),
               description   = COALESCE(EXCLUDED.description,   ads.description),
               advertiser_id = COALESCE(EXCLUDED.advertiser_id, ads.advertiser_id),
               published_at  = COALESCE(EXCLUDED.published_at,  ads.published_at),
               updated_at    = COALESCE(EXCLUDED.updated_at,    ads.updated_at)`,
            [
              ad.id, ad.source, ad.searchTerm, ad.title, ad.price, ad.url,
              ad.notified, ad.created, ad.lastUpdate,
              ad.hash_indexed ?? true, ad.hash_attempts ?? 0, ad.group_id ?? null,
              ad.description ?? null, ad.advertiser_id ?? null,
              ad.published_at ?? null, ad.updated_at ?? null,
            ]
          )
          adsOk++
        }
        await pg.query('COMMIT')
      }

      // 3. search_urls
      for (let i = 0; i < search_urls.length; i += BATCH) {
        const batch = search_urls.slice(i, i + BATCH)
        await pg.query('BEGIN')
        for (const u of batch) {
          await pg.query(
            `INSERT INTO search_urls (source, label, url, active) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
            [u.source, u.label || '', u.url, u.active ?? 1]
          )
          urlsOk++
        }
        await pg.query('COMMIT')
      }

      // 4. ad_image_hashes
      for (let i = 0; i < ad_image_hashes.length; i += BATCH) {
        const batch = ad_image_hashes.slice(i, i + BATCH)
        await pg.query('BEGIN')
        for (const h of batch) {
          await pg.query(
            `INSERT INTO ad_image_hashes (ad_id, ad_source, image_url, phash)
             VALUES ($1,$2,$3,$4) ON CONFLICT (ad_id, ad_source, image_url) DO NOTHING`,
            [h.ad_id, h.ad_source, h.image_url, h.phash]
          )
          hashesOk++
        }
        await pg.query('COMMIT')
      }

      // 5. logs
      for (let i = 0; i < logs.length; i += BATCH) {
        const batch = logs.slice(i, i + BATCH)
        await pg.query('BEGIN')
        for (const l of batch) {
          await pg.query(
            `INSERT INTO logs (url, "adsFound", "averagePrice", "minPrice", "maxPrice", created)
             VALUES ($1,$2,$3,$4,$5,$6)`,
            [l.url, l.adsFound, l.averagePrice, l.minPrice, l.maxPrice, l.created]
          )
          logsOk++
        }
        await pg.query('COMMIT')
      }

      res.json({ ok: true, ads: adsOk, search_urls: urlsOk, logs: logsOk, property_groups: groupsOk, ad_image_hashes: hashesOk, advertisers: advertisersOk })
    } finally {
      pg.release()
      await pool.end()
    }
  } catch (e) { res.status(500).json({ error: e.message }) }
  finally { fs.unlink(filePath, () => {}) }
})

// ── Export CSV (anúncios) ──────────────────────────────────────
app.get('/api/ads/export', async (req, res) => {
  try {
    const { source, notified } = req.query
    const params = []
    let where = 'WHERE 1=1'
    if (source)                              { params.push(source);         where += ` AND source = $${params.length}` }
    if (notified !== undefined && notified !== '') { params.push(Number(notified)); where += ` AND notified = $${params.length}` }
    const ads = await dbAll(`SELECT * FROM ads ${where} ORDER BY created DESC`, params)

    const header = ['id','source','title','price','url','notified','created','lastUpdate','searchTerm']
    const escape = v => `"${String(v ?? '').replace(/"/g, '""')}"`
    const rows   = ads.map(a => header.map(k => escape(a[k])).join(','))
    const csv    = [header.join(','), ...rows].join('\n')

    res.setHeader('Content-Disposition', `attachment; filename="anuncios-${new Date().toISOString().slice(0,10)}.csv"`)
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.send('\uFEFF' + csv) // BOM para Excel reconhecer UTF-8
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// ── Duplicate groups ───────────────────────────────────────────
app.get('/api/groups', async (req, res) => {
  try {
    const groups = await dbAll(`
      SELECT pg.id, pg.created, COUNT(a.id)::int AS ad_count
      FROM property_groups pg
      JOIN ads a ON a.group_id = pg.id
      GROUP BY pg.id, pg.created
      HAVING COUNT(a.id) > 1
      ORDER BY pg.created DESC
      LIMIT 100
    `)
    const result = []
    for (const g of groups) {
      const ads = await dbAll(
        `SELECT id, source, title, price, url, created, notified, hash_indexed
         FROM ads WHERE group_id = $1 ORDER BY created ASC`,
        [g.id]
      )
      result.push({ ...g, ads })
    }
    res.json(result)
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// ── Version ────────────────────────────────────────────────────
app.get('/api/version', (req, res) => {
  try {
    const pkg = require('../package.json')
    res.json({ version: pkg.version })
  } catch { res.json({ version: '?' }) }
})

// ── SPA fallback ───────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../ui/index.html'))
})

module.exports = { app, startServer }

function startServer(port = 3000) {
  app.listen(port, () => {
    const $logger = require('../components/Logger')
    $logger.info(`UI disponível em http://localhost:${port}`)
  })
}
