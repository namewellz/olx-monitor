'use strict'
const cheerio = require('cheerio')
const httpClient = require('../components/HttpClient')
const $logger = require('../components/Logger')
const BaseAdapter = require('./BaseAdapter')

class ZAPAdapter extends BaseAdapter {
  get source() { return 'zap' }

  async extractAdData(ad) {
    try {
      const html = await httpClient(ad.url)
      if (!html) return { imageUrls: [], description: null }
      const $ = cheerio.load(html)
      const byHash = new Map()
      let description = null

      $('script[type="application/ld+json"]').each((_, el) => {
        try {
          const obj  = JSON.parse($(el).html())
          // Descrição: apenas do Product (ignora Organization que é texto auto-gerado)
          if (!description && obj['@type'] === 'Product' && obj.description) {
            description = obj.description.trim()
          }
          const hits = JSON.stringify(obj).match(
            /https:\/\/resizedimgs\.zapimoveis\.com\.br\/img\/vr-listing\/([a-f0-9]{32})\/[^"]+/g
          ) || []
          for (let url of hits) {
            const m = url.match(/\/vr-listing\/([a-f0-9]{32})\//)
            if (!m) continue
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

      // Anunciante + datas: extraídos de script inline (JSON embutido pela SSR do ZAP)
      let advertiser  = null
      let publishedAt = null
      let updatedAt   = null

      const advMatch = html.match(/"advertiser"\s*:\s*\{"id"\s*:\s*"([^"]+)"[^}]{0,200}"name"\s*:\s*"([^"]+)"/)
      if (advMatch) advertiser = { externalId: advMatch[1], name: advMatch[2] }

      const createdMatch = html.match(/"createdAt"\s*:\s*"(20\d\d-[^"]{10,30})"/)
      if (createdMatch) publishedAt = createdMatch[1]

      const updatedMatch = html.match(/"updatedAt"\s*:\s*"(20\d\d-[^"]{10,30})"/)
      if (updatedMatch) updatedAt = updatedMatch[1]

      const imageUrls = [...byHash.values()]
      $logger.info(`[ZAPAdapter] ${imageUrls.length} image(s) found for ad ${ad.id}`)
      return { imageUrls, description, advertiser, publishedAt, updatedAt }
    } catch (err) {
      $logger.error(`[ZAPAdapter] Error extracting data for ad ${ad.id}: ${err.message}`)
      return { imageUrls: [], description: null, advertiser: null, publishedAt: null, updatedAt: null }
    }
  }
}

module.exports = ZAPAdapter
