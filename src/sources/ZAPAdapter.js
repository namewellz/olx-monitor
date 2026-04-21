'use strict'
const cheerio = require('cheerio')
const httpClient = require('../components/HttpClient')
const $logger = require('../components/Logger')
const BaseAdapter = require('./BaseAdapter')

class ZAPAdapter extends BaseAdapter {
  get source() { return 'zap' }

  async extractImageUrls(ad) {
    try {
      const html = await httpClient(ad.url)
      if (!html) return []
      const $ = cheerio.load(html)
      const byHash = new Map()

      $('script[type="application/ld+json"]').each((_, el) => {
        try {
          const obj  = JSON.parse($(el).html())
          const hits = JSON.stringify(obj).match(
            /https:\/\/resizedimgs\.zapimoveis\.com\.br\/img\/vr-listing\/([a-f0-9]{32})\/[^"]+/g
          ) || []
          for (let url of hits) {
            const m = url.match(/\/vr-listing\/([a-f0-9]{32})\//)
            if (!m) continue
            // Máxima resolução disponível no resizer do ZAP
            url = url.replace(/dimension=\d+x\d+/, 'dimension=1600x1200')
            if (!byHash.has(m[1]) || url.length > byHash.get(m[1]).length) {
              byHash.set(m[1], url)
            }
          }
        } catch {}
      })

      // Fallback: og:image
      if (byHash.size === 0) {
        $('meta[property="og:image"], meta[name="og:image"]').each((_, el) => {
          const content = $(el).attr('content') || ''
          const m = content.match(/\/vr-listing\/([a-f0-9]{32})\//)
          if (m) byHash.set(m[1], content)
        })
      }

      const urls = [...byHash.values()]
      $logger.info(`[ZAPAdapter] ${urls.length} image(s) found for ad ${ad.id}`)
      return urls
    } catch (err) {
      $logger.error(`[ZAPAdapter] Error extracting images for ad ${ad.id}: ${err.message}`)
      return []
    }
  }
}

module.exports = ZAPAdapter
