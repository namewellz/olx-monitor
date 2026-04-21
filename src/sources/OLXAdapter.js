'use strict'
const cheerio = require('cheerio')
const httpClient = require('../components/HttpClient')
const $logger = require('../components/Logger')
const BaseAdapter = require('./BaseAdapter')

class OLXAdapter extends BaseAdapter {
  get source() { return 'olx' }

  async extractImageUrls(ad) {
    try {
      const html = await httpClient(ad.url)
      if (!html) return []
      const $ = cheerio.load(html)
      const urls = []

      // Primary: JSON-LD contém todas as imagens (SSR renderiza apenas 5)
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
        } catch {}
      })

      // Fallback: srcset do carrossel SSR (breakpoint desktop)
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
      return urls
    } catch (err) {
      $logger.error(`[OLXAdapter] Error extracting images for ad ${ad.id}: ${err.message}`)
      return []
    }
  }
}

module.exports = OLXAdapter
