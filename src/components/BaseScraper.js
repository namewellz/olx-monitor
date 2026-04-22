'use strict'

const cheerio = require('cheerio')
const $logger = require('./Logger')
const $httpClient = require('./HttpClient.js')
const scraperRepository = require('../repositories/scrapperRepository.js')
const adRepository = require('../repositories/adRepository.js')
const Ad = require('./Ad.js')
const config = require('../config')

/**
 * Factory que cria um scraper completo a partir de funções específicas de cada fonte.
 *
 * @param {object} options
 * @param {string}   options.source        - 'olx' | 'zap' (ou qualquer fonte futura)
 * @param {function} options.getSearchTerm - (url: string) => string
 * @param {function} options.setPageParam  - (url: string, page: number) => string
 * @param {function} options.parsePage     - ($: cheerio, page: number) => { ads: Ad[], nextPage: bool }
 *   onde cada ad é: { id, title, price, url }
 */
const createScraper = ({ source, getSearchTerm, setPageParam, parsePage }) => {

    const tag = `[${source.toUpperCase()}]`

    const urlAlreadySearched = async (url) => {
        try {
            const logs = await scraperRepository.getLogsByUrl(url, 1)
            if (logs.length) return true
            $logger.info(`${tag} First run for this URL`)
            return config.notifyOnFirstRun || false
        } catch (error) {
            $logger.error(error)
            return config.notifyOnFirstRun || false
        }
    }

    // Aceita searchUrlRow (objeto com id e url) ou string de URL para retrocompatibilidade
    return async (searchUrlRow) => {
        const url          = typeof searchUrlRow === 'string' ? searchUrlRow : searchUrlRow.url
        const searchUrlId  = typeof searchUrlRow === 'object' ? searchUrlRow.id : null

        let page = 1
        let maxPrice = 0
        let minPrice = 99999999
        let sumPrices = 0
        let adsFound = 0
        let validAds = 0
        let nextPage = true
        const seenAdIds = []

        const searchTerm = getSearchTerm(url)
        const notify = await urlAlreadySearched(url)
        $logger.info(`${tag} Will notify: ${notify}`)

        do {
            const currentUrl = setPageParam(url, page)
            $logger.info(`${tag} Fetching page ${page}: ${currentUrl}`)

            try {
                const response = await $httpClient(currentUrl)
                const $ = cheerio.load(response)
                const { ads, nextPage: hasNextPage } = await parsePage($, page)

                nextPage = hasNextPage
                adsFound += ads.length

                for (const adData of ads) {
                    $logger.info(`${tag} Ad: ${adData.title} | Price: ${adData.price}`)
                    const ad = new Ad({ ...adData, searchTerm, notify, source, searchUrlId })
                    await ad.process()

                    if (ad.valid) {
                        validAds++
                        seenAdIds.push(String(adData.id))
                        if (adData.price < minPrice) minPrice = adData.price
                        if (adData.price > maxPrice) maxPrice = adData.price
                        sumPrices += adData.price
                    }
                }
            } catch (error) {
                $logger.error(`${tag} Error on page ${page}: ${error.message}`)
                return
            }

            page++

        } while (nextPage)

        $logger.info(`${tag} Done. Valid: ${validAds} / Fetched: ${adsFound}`)

        if (validAds) {
            const averagePrice = sumPrices / validAds
            $logger.info(`${tag} Max: ${maxPrice} | Min: ${minPrice} | Avg: ${averagePrice}`)
            await scraperRepository.saveLog({ url, adsFound: validAds, averagePrice, minPrice, maxPrice })
        }

        // Atualiza ausências e encerra ads que sumiram de todas as buscas
        if (searchUrlId && seenAdIds.length > 0) {
            await adRepository.updateMissingAds(searchUrlId, seenAdIds)
        }
    }
}

module.exports = { createScraper }
