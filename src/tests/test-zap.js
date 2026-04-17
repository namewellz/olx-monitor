'use strict'

// Teste isolado do Scraper2 — não salva no DB, não envia Telegram
// Executa: node test-zap.js

const cheerio = require('cheerio')
const { initializeCycleTLS } = require('../components/CycleTls')
const $httpClient = require('../components/HttpClient.js')

const ZAP_URL = 'https://www.zapimoveis.com.br/venda/casas/sp+indaiatuba++jd-valenca/3-quartos/?onde=%2CS%C3%A3o+Paulo%2CIndaiatuba%2C%2CJardim+Valen%C3%A7a%2C%2C%2Cneighborhood%2CBR%3ESao+Paulo%3ENULL%3EIndaiatuba%3EBarrios%3EJardim+Valenca%2C-23.071581%2C-47.198289%2C&tipos=casa_residencial&quartos=3%2C4&precoMaximo=600000'

const extractIdFromUrl = (url) => {
    if (!url) return null
    const match = url.match(/id-(\d+)/)
    return match ? match[1] : null
}

const parseZapPrice = (priceStr) => {
    if (priceStr == null) return null
    if (typeof priceStr === 'number') return priceStr
    return parseInt(String(priceStr).replace(/\D/g, '')) || null
}

const tryNextData = (script) => {
    try {
        const data = JSON.parse(script)
        const pageProps = data?.props?.pageProps

        // Tenta todos os caminhos conhecidos
        const candidates = [
            pageProps?.listingsResponse?.search?.result?.listings,
            pageProps?.data?.search?.result?.listings,
            pageProps?.listings,
            pageProps?.search?.result?.listings,
        ]

        for (const c of candidates) {
            if (Array.isArray(c) && c.length) return { listings: c, path: 'known path' }
        }

        // Busca recursiva rasa em pageProps
        if (pageProps) {
            for (const key of Object.keys(pageProps)) {
                const val = pageProps[key]
                if (val?.search?.result?.listings) return { listings: val.search.result.listings, path: `pageProps.${key}.search.result.listings` }
                if (val?.result?.listings) return { listings: val.result.listings, path: `pageProps.${key}.result.listings` }
                if (Array.isArray(val?.listings)) return { listings: val.listings, path: `pageProps.${key}.listings` }
            }
        }

        // Retorna a estrutura para diagnóstico
        return { listings: null, pagePropsKeys: pageProps ? Object.keys(pageProps) : [] }
    } catch (e) {
        return { listings: null, error: e.message }
    }
}

const run = async () => {
    console.log('=== ZAP Imóveis Scraper Test ===\n')
    console.log('URL:', ZAP_URL, '\n')

    await initializeCycleTLS()

    console.log('Fetching page...')
    const response = await $httpClient(ZAP_URL)

    if (!response) {
        console.error('ERROR: No response from HttpClient — site may be blocking')
        process.exit(1)
    }

    console.log(`Response received (${(response.length / 1024).toFixed(1)} KB)\n`)

    const $ = cheerio.load(response)
    const script = $('script[id="__NEXT_DATA__"]').text()

    // Try Schema.org JSON-LD ItemList (large inline script without id)
    let jsonLdListings = null
    $('script[type="application/ld+json"], script:not([src]):not([id])').each((_, el) => {
        const text = $(el).text().trim()
        if (!text.includes('"ItemList"')) return
        try {
            const data = JSON.parse(text)
            if (data['@type'] === 'ItemList' && Array.isArray(data.itemListElement)) {
                jsonLdListings = data.itemListElement
            }
        } catch {}
    })

    if (jsonLdListings && jsonLdListings.length) {
        console.log(`\nSUCCESS via Schema.org JSON-LD: ${jsonLdListings.length} listings\n`)
        console.log('--- Sample (first 5) ---\n')
        jsonLdListings.slice(0, 5).forEach((item, i) => {
            const name = item.name || item.item?.name || '(no name)'
            const url  = item.url  || item.item?.url  || '(no url)'
            const id   = extractIdFromUrl(url)
            // price may be in item.offers or item.item.offers
            const offers = item.offers || item.item?.offers
            const price  = offers ? parseZapPrice(offers.price || offers.lowPrice) : null
            console.log(`[${i+1}] ID:    ${id}`)
            console.log(`     Name:  ${name}`)
            console.log(`     Price: ${price ? 'R$ ' + price.toLocaleString('pt-BR') : '(no price)'}`)
            console.log(`     URL:   ${url}`)
            console.log()
        })
        process.exit(0)
    }

    if (!script) {
        console.warn('WARNING: __NEXT_DATA__ not found and no JSON-LD found — inspecting page structure\n')

        // Check _R_ script (ZAP server components format)
        const rScript = $('script[id="_R_"]').text()
        console.log('_R_ script length:', rScript.length)
        if (rScript.length) console.log('_R_ first 200 chars:', rScript.slice(0, 200))

        // Search for known keywords in raw HTML
        console.log('\nKeywords in HTML:')
        for (const kw of ['externalId', '"listings"', 'searchResult', 'listingId', 'pricingInfos', 'NEXT_DATA']) {
            console.log(`  "${kw}": ${response.includes(kw)}`)
        }

        // Extract JSON blocks from _R_ or other inline scripts
        console.log('\n--- All inline script tags with id ---')
        $('script[id]').each((_, el) => {
            const id = $(el).attr('id')
            const text = $(el).text()
            console.log(`  id="${id}" length=${text.length}  first100: ${text.slice(0, 100)}`)
        })

        // Try to find listing URLs in HTML
        const urlMatches = response.match(/\/imovel\/[^"]{10,80}id-\d+/g) || []
        console.log(`\nListing URL patterns found: ${urlMatches.length}`)
        if (urlMatches.length) urlMatches.slice(0, 5).forEach(u => console.log(' ', u))

        // Find context around 'externalId' in raw HTML
        const exIdx = response.indexOf('externalId')
        if (exIdx !== -1) {
            const snippet = response.slice(Math.max(0, exIdx - 100), exIdx + 200)
            console.log('\n--- Context around first "externalId" ---')
            console.log(snippet)
        }

        // Find context around 'listingId'
        const lidIdx = response.indexOf('listingId')
        if (lidIdx !== -1) {
            const snippet = response.slice(Math.max(0, lidIdx - 100), lidIdx + 200)
            console.log('\n--- Context around first "listingId" ---')
            console.log(snippet)
        }

        // Try to find JSON objects/arrays embedded in script tags (no id)
        console.log('\n--- Inline scripts without id (first 3, length > 100) ---')
        let count = 0
        $('script:not([src]):not([id])').each((_, el) => {
            const text = $(el).text().trim()
            if (text.length > 100 && count < 3) {
                console.log(`  length=${text.length} | first200: ${text.slice(0, 200)}\n`)
                count++
            }
        })

        process.exit(1)
    }

    console.log(`__NEXT_DATA__ found (${(script.length / 1024).toFixed(1)} KB)\n`)

    const { listings, path, pagePropsKeys, error } = tryNextData(script)

    if (error) {
        console.error('ERROR parsing __NEXT_DATA__:', error)
        process.exit(1)
    }

    if (!listings) {
        console.warn('WARNING: Listings not found in __NEXT_DATA__')
        console.log('pageProps keys:', pagePropsKeys)

        // Print partial JSON structure for inspection
        try {
            const data = JSON.parse(script)
            const pageProps = data?.props?.pageProps
            if (pageProps) {
                for (const key of Object.keys(pageProps)) {
                    const val = pageProps[key]
                    const type = Array.isArray(val) ? `Array(${val.length})` : typeof val
                    console.log(`  pageProps.${key}: ${type}`)
                    if (val && typeof val === 'object' && !Array.isArray(val)) {
                        for (const subkey of Object.keys(val).slice(0, 5)) {
                            const sub = val[subkey]
                            const subtype = Array.isArray(sub) ? `Array(${sub.length})` : typeof sub
                            console.log(`    .${subkey}: ${subtype}`)
                        }
                    }
                }
            }
        } catch {}
        process.exit(1)
    }

    console.log(`SUCCESS: Found ${listings.length} listings via: ${path}\n`)
    console.log('--- Sample (first 5 ads) ---\n')

    listings.slice(0, 5).forEach((item, i) => {
        const listing = item.listing || item
        const adUrl = listing.link?.href
            ? 'https://www.zapimoveis.com.br' + listing.link.href
            : null
        const id = extractIdFromUrl(adUrl) || listing.externalId
        const title = listing.description || listing.title || '(no title)'
        const priceInfo = listing.pricingInfos?.[0]
        const price = priceInfo ? parseZapPrice(priceInfo.price) : null
        const area = listing.usableAreas?.[0] || listing.totalAreas?.[0] || null
        const bedrooms = listing.bedrooms?.[0] || null

        console.log(`[${i + 1}] ID: ${id}`)
        console.log(`    Title:  ${title}`)
        console.log(`    Price:  ${price ? 'R$ ' + price.toLocaleString('pt-BR') : '(no price)'}`)
        console.log(`    Area:   ${area ? area + ' m²' : '(n/a)'}`)
        console.log(`    Rooms:  ${bedrooms || '(n/a)'}`)
        console.log(`    URL:    ${adUrl || '(n/a)'}`)
        console.log()
    })

    console.log(`Total on this page: ${listings.length}`)
    process.exit(0)
}

run().catch(err => {
    console.error('Fatal error:', err)
    process.exit(1)
})
