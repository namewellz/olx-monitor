'use strict'

const cheerio = require('cheerio')
const $logger = require('./Logger')
const $httpClient = require('./HttpClient.js')
const scraperRepository = require('../repositories/scrapperRepository.js')
const Ad = require('./Ad.js')
const config = require('../config')

// ZAP Imóveis uses 'pagina' param for pagination (unlike OLX which uses 'o')
const setPageParam = (url, page) => {
    const newUrl = new URL(url)
    if (page === 1) {
        newUrl.searchParams.delete('pagina')
    } else {
        newUrl.searchParams.set('pagina', page)
    }
    return newUrl.toString()
}

// Extract numeric ID from ZAP URL pattern: .../id-2832086118/
const extractIdFromUrl = (url) => {
    if (!url) return null
    const match = url.match(/id-(\d+)/)
    return match ? parseInt(match[1]) : null
}

// Parse ZAP price — accepts string "R$ 540.000" or raw number
const parseZapPrice = (priceStr) => {
    if (priceStr == null) return 0
    if (typeof priceStr === 'number') return priceStr
    return parseInt(String(priceStr).replace(/\D/g, '')) || 0
}

// Extract search term label from URL path for logging/DB
const getSearchTerm = (url) => {
    try {
        const parsed = new URL(url)
        // e.g. /venda/casas/3-quartos/estado-sp/grande-campinas/indaiatuba
        const parts = parsed.pathname.split('/').filter(Boolean)
        return parts.slice(0, 4).join('/') || parsed.hostname
    } catch {
        return url
    }
}

// Extract listings from Schema.org JSON-LD ItemList embedded in the page
// ZAP uses this instead of __NEXT_DATA__ — it's a large inline <script> tag
const extractFromJsonLd = ($) => {
    let listings = null
    let totalCount = 0

    $('script[type="application/ld+json"], script:not([src]):not([id])').each((_, el) => {
        if (listings) return // already found
        const text = $(el).text().trim()
        if (!text.includes('"ItemList"')) return
        try {
            const data = JSON.parse(text)
            if (data['@type'] === 'ItemList' && Array.isArray(data.itemListElement)) {
                listings = data.itemListElement
                totalCount = data.numberOfItems || listings.length
            }
        } catch {}
    })

    return { listings, totalCount }
}

// HTML fallback parser using cheerio — based on ZAP's CSS structure
// Relies on: article[data-id], or section > a with id in href
const extractFromHtml = ($) => {
    const results = []

    // ZAP listing cards are <div> or <article> elements with a link containing the listing URL
    $('a[href*="/imovel/"], a[href*="/lancamentos/"]').each((_, el) => {
        const href = $(el).attr('href')
        if (!href || !href.match(/id-\d+/)) return
        const url = href.startsWith('http') ? href : 'https://www.zapimoveis.com.br' + href

        // Avoid duplicates
        if (results.find(r => r.url === url)) return

        const card = $(el).closest('section, article, li, div[data-id]')
        const title = card.find('[class*="title"], [class*="Title"], h2, h3').first().text().trim()
        const priceText = card.find('[class*="price"], [class*="Price"]').first().text().trim()
        const area = card.find('[aria-label*="m²"], [class*="area"]').first().text().trim()

        results.push({ url, title, priceText, area })
    })

    return results
}

const scraper2 = async (url) => {
    let page = 1
    let maxPrice = 0
    let minPrice = 99999999
    let sumPrices = 0
    let adsFound = 0
    let validAds = 0
    let nextPage = true

    const searchTerm = getSearchTerm(url)
    const notify = await urlAlreadySearched(url)
    $logger.info(`[ZAP] Will notify: ${notify}`)

    const scrapePage = async ($) => {
        try {
            // --- Strategy 1: Schema.org JSON-LD ItemList ---
            const { listings, totalCount } = extractFromJsonLd($)

            if (listings && listings.length) {
                const totalPages = Math.ceil(totalCount / listings.length) || 1
                $logger.info(`[ZAP] JSON-LD: ${listings.length} listings (total: ${totalCount}, pages ~${totalPages})`)
                adsFound += listings.length

                for (const item of listings) {
                    const adUrl = item.url || item.item?.url || null
                    const id    = extractIdFromUrl(adUrl)
                    if (!id || !adUrl) continue

                    const title  = item.name || item.item?.name || ''
                    const offers = item.offers || item.item?.offers
                    const price  = parseZapPrice(offers?.price || offers?.lowPrice)

                    $logger.info(`[ZAP] Ad: ${title} | Price: ${price}`)

                    const ad = new Ad({ id, url: adUrl, title, searchTerm, price, notify, source: 'zap' })
                    await ad.process()

                    if (ad.valid) {
                        validAds++
                        if (price < minPrice) minPrice = price
                        if (price > maxPrice) maxPrice = price
                        sumPrices += price
                    }
                }

                return { nextPage: page < totalPages }
            }

            // --- Strategy 2: HTML fallback (link hrefs com id-NNNN) ---
            $logger.info(`[ZAP] JSON-LD not found — falling back to HTML parser`)
            const htmlListings = extractFromHtml($)
            $logger.info(`[ZAP] HTML fallback found ${htmlListings.length} links`)
            adsFound += htmlListings.length

            for (const item of htmlListings) {
                const id = extractIdFromUrl(item.url)
                if (!id) continue

                const price = parseZapPrice(item.priceText)
                const title = item.title || item.url

                $logger.info(`[ZAP] Ad (html): ${title} | Price: ${price}`)

                const ad = new Ad({ id, url: item.url, title, searchTerm, price, notify, source: 'zap' })
                await ad.process()

                if (ad.valid) {
                    validAds++
                    if (price < minPrice) minPrice = price
                    if (price > maxPrice) maxPrice = price
                    sumPrices += price
                }
            }

            // Detecta última página pelos botões de paginação
            const lastPageBtn = $('[aria-label]').filter((_, el) => {
                const label = $(el).attr('aria-label') || ''
                return label.startsWith('página ') && !isNaN(parseInt(label.replace('página ', '')))
            }).last()

            const lastPageNum = lastPageBtn.length
                ? parseInt(lastPageBtn.attr('aria-label').replace('página ', ''))
                : 1

            return { nextPage: page < lastPageNum }

        } catch (error) {
            $logger.error('[ZAP] scrapePage error: ' + error.message)
            throw error
        }
    }

    do {
        const currentUrl = setPageParam(url, page)
        $logger.info('[ZAP] Fetching: ' + currentUrl)

        try {
            const response = await $httpClient(currentUrl)
            const $        = cheerio.load(response)
            const result   = await scrapePage($)
            nextPage       = result.nextPage
        } catch (error) {
            $logger.error('[ZAP] Fetch error: ' + error.message)
            return
        }

        page++

    } while (nextPage)

    $logger.info(`[ZAP] Done. Valid ads: ${validAds} / Total fetched: ${adsFound}`)

    if (validAds) {
        const averagePrice = sumPrices / validAds

        $logger.info('[ZAP] Maximum price: ' + maxPrice)
        $logger.info('[ZAP] Minimum price: ' + minPrice)
        $logger.info('[ZAP] Average price: ' + averagePrice)

        await scraperRepository.saveLog({ url, adsFound: validAds, averagePrice, minPrice, maxPrice })
    }
}

const urlAlreadySearched = async (url) => {
    try {
        const ad = await scraperRepository.getLogsByUrl(url, 1)
        if (ad.length) return true
        $logger.info('[ZAP] First run for this URL — notifyOnFirstRun: ' + config.notifyOnFirstRun)
        return config.notifyOnFirstRun
    } catch (error) {
        $logger.error(error)
        return config.notifyOnFirstRun
    }
}

module.exports = { scraper2 }
