'use strict'
const { getCycleTLSInstance } = require('./CycleTls')
const $logger = require('./Logger')

const DELAY_MIN  = 1500
const DELAY_MAX  = 3000
const MAX_RETRIES = 3

function randomDelay() {
  return new Promise(r => setTimeout(r, DELAY_MIN + Math.random() * (DELAY_MAX - DELAY_MIN)))
}

async function downloadOne(cycleTLS, url, attempt = 1) {
  try {
    const response = await cycleTLS(url, {
      ja3: '771,4865-4867-4866-49195-49199-52393-52392-49196-49200-49162-49161-49171-49172-51-57-47-53,0-23-65281-10-11-35-16-5-51-43-13-45-28-21,29-23-24-25-256-257,0',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      headers: {
        Accept:  'image/webp,image/apng,image/*,*/*;q=0.8',
        Referer: 'https://www.zapimoveis.com.br/',
      },
    }, 'GET')

    if (response.status === 200 && response.body) {
      return Buffer.from(response.body, 'base64')
    }

    // 404 no ZAP pode ser soft-block — sempre retenta
    if (attempt < MAX_RETRIES) {
      const delay = attempt * 3000
      $logger.warn(`[ImageDownloader] HTTP ${response.status} for ${url} — retry ${attempt}/${MAX_RETRIES} in ${delay / 1000}s`)
      await new Promise(r => setTimeout(r, delay))
      return downloadOne(cycleTLS, url, attempt + 1)
    }

    $logger.warn(`[ImageDownloader] Gave up after ${MAX_RETRIES} attempts: ${url} (HTTP ${response.status})`)
    return null

  } catch (err) {
    if (attempt < MAX_RETRIES) {
      const delay = attempt * 3000
      $logger.warn(`[ImageDownloader] Error (${err.message}) for ${url} — retry ${attempt}/${MAX_RETRIES} in ${delay / 1000}s`)
      await new Promise(r => setTimeout(r, delay))
      return downloadOne(cycleTLS, url, attempt + 1)
    }
    $logger.warn(`[ImageDownloader] Gave up after ${MAX_RETRIES} attempts: ${url}`)
    return null
  }
}

async function downloadImages(imageUrls) {
  const cycleTLS = await getCycleTLSInstance()
  const results  = []

  for (let i = 0; i < imageUrls.length; i++) {
    const url    = imageUrls[i]
    const buffer = await downloadOne(cycleTLS, url)
    results.push({ url, buffer })
    if (i < imageUrls.length - 1) await randomDelay()
  }

  return results
}

module.exports = { downloadImages }
