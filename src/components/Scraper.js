'use strict'

const cheerio = require('cheerio')
const $logger = require('./Logger')
const $httpClient = require('./HttpClient.js')
const scraperRepository = require('../repositories/scrapperRepository.js')
const Ad = require('./Ad.js')
const config = require('../config')

const scraper = async (url) => {
    let page = 1
    let maxPrice = 0
    let minPrice = 99999999
    let sumPrices = 0
    let adsFound = 0
    let validAds = 0
    let nextPage = true

    const parsedUrl = new URL(url)
    const searchTerm = parsedUrl.searchParams.get('q') || ''
    const notify = await urlAlreadySearched(url)
    $logger.info(`Will notify: ${notify}`)

    const scrapePage = async ($, searchTerm, notify) => {
        try {
            const script = $('script[id="__NEXT_DATA__"]').text()
            if (!script) return { nextPage: false }

            const pageProps = JSON.parse(script).props.pageProps
            const adList = pageProps.ads

            if (!Array.isArray(adList) || !adList.length) return { nextPage: false }

            const totalOfAds = pageProps.totalOfAds || 0
            const pageSize = pageProps.pageSize || 50
            const totalPages = Math.ceil(totalOfAds / pageSize)
            const currentPage = pageProps.pageIndex || 1

            $logger.info(`Page ${currentPage} of ${totalPages} (${totalOfAds} total ads)`)
            adsFound += adList.length

            $logger.info(`Checking new ads for: ${searchTerm}`)
            $logger.info('Ads found: ' + adsFound)

            for (let i = 0; i < adList.length; i++) {
                $logger.debug('Checking ad: ' + (i + 1))

                const advert = adList[i]
                const title = advert.subject
                const id = advert.listId
                const adUrl = advert.url
                const price = parseInt(advert.price?.replace('R$ ', '')?.replace('.', '') || '0')

                const result = { id, url: adUrl, title, searchTerm, price, notify, source: 'olx' }

                const ad = new Ad(result)
                $logger.info(`Ad: ${title} | Price: ${price}`)
                await ad.process()  // ← await adicionado

                if (ad.valid) {
                    validAds++
                    minPrice = checkMinPrice(ad.price, minPrice)
                    maxPrice = checkMaxPrice(ad.price, maxPrice)
                    sumPrices += ad.price
                }
            }

            return { nextPage: currentPage < totalPages }

        } catch (error) {
            $logger.error(error)
            throw new Error('Scraping failed')
        }
    }

    do {
        const currentUrl = setUrlParam(url, 'o', page)
        $logger.info('URL: ' + currentUrl)
        try {
            const response = await $httpClient(currentUrl)
            const $        = cheerio.load(response)
            const result   = await scrapePage($, searchTerm, notify)
            nextPage       = result.nextPage
        } catch (error) {
            $logger.error(error)
            return
        }
        page++

    } while (nextPage)

    $logger.info('Valid ads: ' + validAds)

    if (validAds) {
        const averagePrice = sumPrices / validAds

        $logger.info('Maximum price: ' + maxPrice)
        $logger.info('Minimum price: ' + minPrice)
        $logger.info('Average price: ' + averagePrice)

        const scrapperLog = {
            url,
            adsFound: validAds,
            averagePrice,
            minPrice,
            maxPrice,
        }

        await scraperRepository.saveLog(scrapperLog)
    }
}

const urlAlreadySearched = async (url) => {
    try {
        const ad = await scraperRepository.getLogsByUrl(url, 1)
        if (ad.length) {
            return true
        }
        $logger.info('First run, no notifications')
        return config.notifyOnFirstRun  // ← usa config corretamente
    } catch (error) {
        $logger.error(error)
        return config.notifyOnFirstRun
    }
}

const setUrlParam = (url, param, value) => {
    const newUrl = new URL(url)
    let searchParams = newUrl.searchParams
    searchParams.set(param, value)
    newUrl.search = searchParams.toString()
    return newUrl.toString()
}

const checkMinPrice = (price, minPrice) => {
    if (price < minPrice) return price
    return minPrice
}

const checkMaxPrice = (price, maxPrice) => {
    if (price > maxPrice) return price
    return maxPrice
}

module.exports = { scraper }