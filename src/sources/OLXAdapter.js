'use strict'
const cheerio = require('cheerio')
const httpClient = require('../components/HttpClient')
const $logger = require('../components/Logger')
const BaseAdapter = require('./BaseAdapter')

class OLXAdapter extends BaseAdapter {
  get source() { return 'olx' }

  async extractAdData(ad) {
    try {
      const html = await httpClient(ad.url)
      if (!html) return { imageUrls: [], description: null }
      const $ = cheerio.load(html)
      const urls = []
      let description = null

      let advertiser  = null
      let publishedAt = null

      // JSON-LD BuyAction: imagens + descrição + anunciante numa única passagem
      $('script[type="application/ld+json"]').each((_, el) => {
        try {
          const obj    = JSON.parse($(el).html())
          const images = obj.Object?.image || obj.image || []
          for (const img of images) {
            const url = img.contentUrl || img.url || ''
            if (url.includes('img.olx.com.br')) {
              urls.push(url.replace(/\.(jpg|jpeg|png)$/i, '.webp'))
            }
          }
          if (!description && obj.Object?.description) {
            description = obj.Object.description.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').trim()
          }
          if (!advertiser && obj.seller?.name) {
            advertiser = { name: obj.seller.name, externalId: obj.seller.name }
          }
        } catch {}
      })

      // Data de publicação: origListTime (Unix timestamp 10 dígitos no HTML)
      const tsMatch = html.match(/origListTime(?:&quot;|"):(\d{10})/)
      if (tsMatch) publishedAt = new Date(Number(tsMatch[1]) * 1000).toISOString()

      // Fallback imagens: srcset do carrossel SSR (breakpoint desktop)
      if (urls.length === 0) {
        $('#gallery source[type="image/webp"]').each((_, el) => {
          const media = $(el).attr('media') || ''
          if (media.includes('431px')) {
            const src = $(el).attr('srcset') || ''
            if (src) urls.push(src)
          }
        })
      }

      $logger.info(`[OLXAdapter] ${urls.length} image(s) found for ad ${ad.id}`)
      return { imageUrls: urls, description, advertiser, publishedAt, updatedAt: null }
    } catch (err) {
      $logger.error(`[OLXAdapter] Error extracting data for ad ${ad.id}: ${err.message}`)
      return { imageUrls: [], description: null, advertiser: null, publishedAt: null, updatedAt: null }
    }
  }
}

module.exports = OLXAdapter
