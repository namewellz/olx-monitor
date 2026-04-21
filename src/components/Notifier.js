'use strict'
const axios          = require('axios')
const config         = require('../config')
const adRepository   = require('../repositories/adRepository')
const { query }      = require('../database/database')
const $logger        = require('./Logger')

const delay = ms => new Promise(r => setTimeout(r, ms))

// ── Telegram helpers ────────────────────────────────────────────

function chatIdFor(source) {
  if (source === 'zap' && config.telegramChatIdZap) return config.telegramChatIdZap
  return config.telegramChatID
}

async function sendWithRetry(token, chatId, text, retries = 3) {
  const url = `https://api.telegram.org/bot${token}/sendMessage`
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await axios.post(url, { chat_id: chatId, text, disable_web_page_preview: true }, { timeout: 10000 })
      return true
    } catch (err) {
      $logger.error(`Attempt ${attempt}/${retries} failed: ${err.message}`)
      if (attempt < retries) {
        const wait = attempt * 2000
        $logger.error(`Retrying in ${wait / 1000}s…`)
        await delay(wait)
      }
    }
  }
  return false
}

// ── Message builders ────────────────────────────────────────────

function formatPrice(p) {
  const n = Number(p)
  return isNaN(n) ? String(p) : 'R$ ' + n.toLocaleString('pt-BR')
}

function formatDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return isNaN(d) ? '' : d.toLocaleDateString('pt-BR')
}

function buildNormalMessage(ad) {
  const src = (ad.source || 'olx').toUpperCase()
  return (
    `[${src}] Novo anúncio encontrado!\n` +
    `${ad.title}\n` +
    `${formatPrice(ad.price)}\n\n` +
    `${ad.url}`
  )
}

function buildGroupedMessage(ad, siblings) {
  const src = (ad.source || 'olx').toUpperCase()
  let msg =
    `⚠️ [${src}] Imóvel já publicado anteriormente\n\n` +
    `${ad.title}\n` +
    `${formatPrice(ad.price)}\n` +
    `${ad.url}\n\n` +
    `─────────────────\n` +
    `Links já publicados:\n`

  for (const s of siblings) {
    const sSource = (s.source || '').toUpperCase()
    msg += `\n• [${sSource}] ${formatPrice(s.price)} — ${formatDate(s.created)}\n  ${s.url}`
  }

  return msg
}

// ── Public API ──────────────────────────────────────────────────

exports.sendNotification = async (msg, adId, source) => {
  if (process.env.DISABLE_NOTIFICATIONS === 'true') {
    $logger.info(`[NOTIFICATIONS DISABLED] Skipping: ${msg.substring(0, 60)}`)
    return
  }
  try {
    const token  = config.telegramToken
    const chatId = chatIdFor(source)
    const ok     = await sendWithRetry(token, chatId, msg)
    if (ok) {
      if (adId && source) await adRepository.markAsNotified(adId, source)
      $logger.info(`Notification sent for ad ${adId} [${source}]`)
    } else {
      $logger.error(`Failed to notify ad ${adId} [${source}] — will retry on next run`)
    }
    await delay(1500)
  } catch (err) {
    $logger.error(`Unexpected error sending notification: ${err.message}`)
  }
}

exports.processPendingNotifications = async () => {
  try {
    const pending = await adRepository.getPendingNotifications()
    if (pending.length === 0) return

    $logger.info(`Processing ${pending.length} pending notification(s)`)
    const batch = pending.slice(0, 10)

    for (const ad of batch) {
      let msg

      // Verifica se o imóvel tem outros anúncios no mesmo grupo
      if (ad.group_id) {
        const { rows: siblings } = await query(
          `SELECT id, source, title, price, url, created
           FROM ads
           WHERE group_id = $1 AND NOT (id = $2 AND source = $3)
           ORDER BY created ASC`,
          [ad.group_id, ad.id, ad.source]
        )
        msg = siblings.length > 0
          ? buildGroupedMessage(ad, siblings)
          : buildNormalMessage(ad)
      } else {
        msg = buildNormalMessage(ad)
      }

      await exports.sendNotification(msg, ad.id, ad.source)
    }

    const remaining = pending.length - batch.length
    if (remaining > 0) $logger.info(`${remaining} notification(s) remaining for next run`)

  } catch (err) {
    $logger.error(`Error processing pending notifications: ${err.message}`)
  }
}
