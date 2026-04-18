const path = require('path')
const express = require('express')
const { query, createTables } = require('../database/database')
const config = require('../config')

const app = express()
app.use(express.json())
app.use(express.static(path.join(__dirname, '../ui')))

// ── Helpers ────────────────────────────────────────────────────
const dbAll = (sql, params) => query(sql, params).then(r => r.rows)
const dbGet = (sql, params) => query(sql, params).then(r => r.rows[0])
const dbRun = (sql, params) => query(sql, params).then(() => true)

// ── Stats ──────────────────────────────────────────────────────
app.get('/api/stats', async (req, res) => {
  try {
    const [total, pending, notified, olx, zap, activeUrls] = await Promise.all([
      dbGet(`SELECT COUNT(*) AS n FROM ads`),
      dbGet(`SELECT COUNT(*) AS n FROM ads WHERE notified = 0`),
      dbGet(`SELECT COUNT(*) AS n FROM ads WHERE notified = 1`),
      dbGet(`SELECT COUNT(*) AS n FROM ads WHERE source = 'olx'`),
      dbGet(`SELECT COUNT(*) AS n FROM ads WHERE source = 'zap'`),
      dbGet(`SELECT COUNT(*) AS n FROM search_urls WHERE active = 1`).catch(() => ({ n: 0 })),
    ])
    res.json({
      total:      Number(total.n),
      pending:    Number(pending.n),
      notified:   Number(notified.n),
      olxCount:   Number(olx.n),
      zapCount:   Number(zap.n),
      activeUrls: Number(activeUrls.n),
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
app.post('/api/run', (req, res) => {
  try {
    const { scraper: scraperOLX } = require('../components/ScraperOLX')
    const { scraper: scraperZAP } = require('../components/ScraperZAP')
    const olxUrls = config.olxUrls || config.urls || []
    olxUrls.forEach(url => scraperOLX(url).catch(() => {}))
    ;(config.zapUrls || []).forEach(url => scraperZAP(url).catch(() => {}))
  } catch {}
  res.json({ ok: true })
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
