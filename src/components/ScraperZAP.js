'use strict'

const { createScraper } = require('./BaseScraper')

const getSearchTerm = (url) => {
    try {
        const parts = new URL(url).pathname.split('/').filter(Boolean)
        return parts.slice(0, 4).join('/')
    } catch {
        return url
    }
}

const setPageParam = (url, page) => {
    const newUrl = new URL(url)
    if (page === 1) {
        newUrl.searchParams.delete('pagina')
    } else {
        newUrl.searchParams.set('pagina', page)
    }
    return newUrl.toString()
}

const extractIdFromUrl = (url) => {
    if (!url) return null
    const match = url.match(/id-(\d+)/)
    return match ? parseInt(match[1]) : null
}

const parsePrice = (priceStr) => {
    if (priceStr == null) return 0
    if (typeof priceStr === 'number') return priceStr
    return parseInt(String(priceStr).replace(/\D/g, '')) || 0
}

/**
 * Estratégia 1: Schema.org JSON-LD ItemList (método principal do ZAP).
 * Estratégia 2: fallback por links href com padrão id-NNNN no HTML.
 * Retorna: { ads: [{ id, title, price, url }], nextPage: bool }
 */
const parsePage = ($, page) => {
    // --- Estratégia 1: JSON-LD ItemList ---
    let listings = null
    let totalCount = 0

    $('script[type="application/ld+json"], script:not([src]):not([id])').each((_, el) => {
        if (listings) return
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

    if (listings && listings.length) {
        const totalPages = Math.ceil(totalCount / listings.length) || 1
        const ads = listings.map(item => ({
            id:    extractIdFromUrl(item.url || item.item?.url),
            title: item.name || item.item?.name || '',
            price: parsePrice((item.offers || item.item?.offers)?.price
                           || (item.offers || item.item?.offers)?.lowPrice),
            url:   item.url || item.item?.url || null,
        })).filter(a => a.id && a.url)

        return { ads, nextPage: page < totalPages }
    }

    // --- Estratégia 2: fallback HTML ---
    const seen = new Set()
    const ads = []

    $('a[href*="/imovel/"], a[href*="/lancamentos/"]').each((_, el) => {
        const href = $(el).attr('href')
        if (!href || !href.match(/id-\d+/)) return
        const url = href.startsWith('http') ? href : 'https://www.zapimoveis.com.br' + href
        if (seen.has(url)) return
        seen.add(url)

        const id    = extractIdFromUrl(url)
        const card  = $(el).closest('section, article, li, div[data-id]')
        const title = card.find('[class*="title"], [class*="Title"], h2, h3').first().text().trim()
        const price = parsePrice(card.find('[class*="price"], [class*="Price"]').first().text().trim())

        if (id) ads.push({ id, title, price, url })
    })

    const lastPageNum = (() => {
        let max = 1
        $('[aria-label]').each((_, el) => {
            const label = $(el).attr('aria-label') || ''
            const n = parseInt(label.replace('página ', ''))
            if (!isNaN(n) && n > max) max = n
        })
        return max
    })()

    return { ads, nextPage: page < lastPageNum }
}

module.exports = {
    scraper: createScraper({ source: 'zap', getSearchTerm, setPageParam, parsePage })
}
