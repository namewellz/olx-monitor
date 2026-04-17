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

// Parse ZAP price format: "R$ 540.000" → 540000
const parseZapPrice = (priceStr) => {
    if (!priceStr) return 0
    return parseInt(priceStr.replace('R$ ', '').replace(/\./g, '').trim()) || 0
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

// Try to extract listings from ZAP's __NEXT_DATA__ script
// ZAP injects server-side data at multiple possible paths — try all known ones
const extractFromNextData = (script) => {
    try {
        const data = JSON.parse(script)

        // Known paths in ZAP's __NEXT_DATA__
        const candidates = [
            data?.props?.pageProps?.listingsResponse?.search?.result?.listings,
            data?.props?.pageProps?.data?.search?.result?.listings,
            data?.props?.pageProps?.listings,
            data?.props?.pageProps?.search?.result?.listings,
        ]

        for (const candidate of candidates) {
            if (Array.isArray(candidate) && candidate.length) {
                return candidate
            }
        }

        // Try to find 'listings' anywhere one level deep in pageProps
        const pageProps = data?.props?.pageProps
        if (pageProps) {
            for (const key of Object.keys(pageProps)) {
                const val = pageProps[key]
                if (val?.search?.result?.listings) return val.search.result.listings
                if (val?.result?.listings) return val.result.listings
                if (Array.isArray(val?.listings)) return val.listings
            }
        }

        return null
    } catch {
        return null
    }
}

// Extract total pages from __NEXT_DATA__
const extractTotalPages = (script) => {
    try {
        const data = JSON.parse(script)
        const pageProps = data?.props?.pageProps

        const candidates = [
            pageProps?.listingsResponse?.search?.totalCount,
            pageProps?.data?.search?.totalCount,
            pageProps?.search?.totalCount,
        ]

        for (const total of candidates) {
            if (typeof total === 'number') {
                return Math.ceil(total / 36) // ZAP default page size is 36
            }
        }

        return null
    } catch {
        return null
    }
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

    const scrapePage = async ($, script) => {
        try {
            let listings = null
            let totalPages = 1

            // --- Strategy 1: __NEXT_DATA__ ---
            if (script) {
                listings = extractFromNextData(script)
                totalPages = extractTotalPages(script) || 1
            }

            if (listings && listings.length) {
                $logger.info(`[ZAP] Using __NEXT_DATA__ — ${listings.length} listings found (total pages: ${totalPages})`)
                adsFound += listings.length

                for (const item of listings) {
                    // ZAP wraps listing data under .listing or directly
                    const listing = item.listing || item

                    const adUrl = listing.externalId
                        ? `https://www.zapimoveis.com.br/imovel/${listing.slug || ''}-id-${listing.externalId}/`
                        : listing.link?.href || null

                    const id = extractIdFromUrl(adUrl) || listing.externalId || listing.id
                    const title = listing.description || listing.title || ''
                    const priceStr = listing.pricingInfos?.[0]?.price
                        || listing.listing?.pricingInfos?.[0]?.price
                        || null
                    const price = parseZapPrice(priceStr ? 'R$ ' + priceStr : null)

                    if (!id || !adUrl) continue

                    $logger.info(`[ZAP] Ad: ${title} | Price: ${price}`)

                    const ad = new Ad({ id, url: adUrl, title, searchTerm, price, notify })
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

            // --- Strategy 2: HTML fallback ---
            $logger.info(`[ZAP] __NEXT_DATA__ listings not found — falling back to HTML parser`)
            const htmlListings = extractFromHtml($)
            $logger.info(`[ZAP] HTML fallback found ${htmlListings.length} links`)
            adsFound += htmlListings.length

            for (const item of htmlListings) {
                const id = extractIdFromUrl(item.url)
                if (!id) continue

                const price = parseZapPrice(item.priceText)
                const title = item.title || item.url

                $logger.info(`[ZAP] Ad (html): ${title} | Price: ${price}`)

                const ad = new Ad({ id, url: item.url, title, searchTerm, price, notify })
                await ad.process()

                if (ad.valid) {
                    validAds++
                    if (price < minPrice) minPrice = price
                    if (price > maxPrice) maxPrice = price
                    sumPrices += price
                }
            }

            // Check pagination via aria-label on pagination buttons
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
            const script   = $('script[id="__NEXT_DATA__"]').text()

            if (!script) {
                $logger.error('[ZAP] No __NEXT_DATA__ found — site may be blocking the request')
            }

            const result = await scrapePage($, script)
            nextPage     = result.nextPage
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
