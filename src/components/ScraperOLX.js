'use strict'

const { createScraper } = require('./BaseScraper')

const getSearchTerm = (url) => {
    return new URL(url).searchParams.get('q') || ''
}

const setPageParam = (url, page) => {
    const newUrl = new URL(url)
    newUrl.searchParams.set('o', page)
    return newUrl.toString()
}

/**
 * Extrai anúncios do __NEXT_DATA__ injetado pelo OLX (Next.js).
 * Retorna: { ads: [{ id, title, price, url }], nextPage: bool }
 */
const parsePage = ($, page) => {
    const script = $('script[id="__NEXT_DATA__"]').text()
    if (!script) return { ads: [], nextPage: false }

    const pageProps = JSON.parse(script).props.pageProps
    const adList = pageProps.ads

    if (!Array.isArray(adList) || !adList.length) return { ads: [], nextPage: false }

    const totalOfAds = pageProps.totalOfAds || 0
    const pageSize   = pageProps.pageSize || 50
    const totalPages = Math.ceil(totalOfAds / pageSize)
    const currentPage = pageProps.pageIndex || page

    const ads = adList.map(advert => ({
        id:    advert.listId,
        title: advert.subject,
        price: parseInt(advert.price?.replace('R$ ', '')?.replace('.', '') || '0'),
        url:   advert.url,
    })).filter(a => a.id && a.url)

    return { ads, nextPage: currentPage < totalPages }
}

module.exports = {
    scraper: createScraper({ source: 'olx', getSearchTerm, setPageParam, parsePage })
}
