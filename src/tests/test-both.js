'use strict'

// Teste lado a lado: OLX + ZAP — sem salvar no DB, sem Telegram
// Executa: node test-both.js

const cheerio = require('cheerio')
const { initializeCycleTLS } = require('../components/CycleTls')
const $httpClient = require('../components/HttpClient.js')

const OLX_URL = 'https://www.olx.com.br/imoveis/venda/estado-sp/grande-campinas/indaiatuba?pe=600000&sf=1&ret=1040'
const ZAP_URL = 'https://www.zapimoveis.com.br/venda/casas/sp+indaiatuba++jd-valenca/3-quartos/?onde=%2CS%C3%A3o+Paulo%2CIndaiatuba%2C%2CJardim+Valen%C3%A7a%2C%2C%2Cneighborhood%2CBR%3ESao+Paulo%3ENULL%3EIndaiatuba%3EBarrios%3EJardim+Valenca%2C-23.071581%2C-47.198289%2C&tipos=casa_residencial&quartos=3%2C4&precoMaximo=600000'

// ─── OLX parser ────────────────────────────────────────────────────────────

const parseOlx = (html) => {
    const $ = cheerio.load(html)
    const script = $('script[id="__NEXT_DATA__"]').text()
    if (!script) return { ads: [], error: '__NEXT_DATA__ not found' }

    try {
        const pageProps = JSON.parse(script).props.pageProps
        const adList = pageProps.ads
        if (!Array.isArray(adList) || !adList.length) return { ads: [], error: 'ads array empty' }

        const totalOfAds = pageProps.totalOfAds || 0
        const pageSize   = pageProps.pageSize || 50
        const totalPages = Math.ceil(totalOfAds / pageSize)

        const ads = adList.map(advert => ({
            source:  'OLX',
            id:      advert.listId,
            title:   advert.subject,
            price:   parseInt(advert.price?.replace('R$ ', '')?.replace('.', '') || '0'),
            url:     advert.url,
        })).filter(a => a.id && a.url)

        return { ads, totalOfAds, totalPages }
    } catch (e) {
        return { ads: [], error: e.message }
    }
}

// ─── ZAP parser ────────────────────────────────────────────────────────────

const parseZap = (html) => {
    const $ = cheerio.load(html)
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

    if (!listings) return { ads: [], error: 'ItemList JSON-LD not found' }

    const ads = listings.map(item => {
        const url    = item.url || item.item?.url || null
        const idMatch = url?.match(/id-(\d+)/)
        const id     = idMatch ? parseInt(idMatch[1]) : null
        const title  = item.name || item.item?.name || ''
        const offers = item.offers || item.item?.offers
        const priceRaw = offers?.price || offers?.lowPrice
        const price  = priceRaw != null
            ? (typeof priceRaw === 'number' ? priceRaw : parseInt(String(priceRaw).replace(/\D/g, '')) || 0)
            : 0
        return { source: 'ZAP', id, title, price, url }
    }).filter(a => a.id && a.url)

    return { ads, totalCount, totalPages: Math.ceil(totalCount / (listings.length || 1)) }
}

// ─── Display ───────────────────────────────────────────────────────────────

const printResults = ({ label, url, ads, totalOfAds, totalCount, totalPages, error, elapsed }) => {
    const total = totalOfAds || totalCount || ads.length
    console.log(`\n${'═'.repeat(60)}`)
    console.log(` ${label}`)
    console.log(`${'═'.repeat(60)}`)
    console.log(` URL:     ${url}`)
    console.log(` Tempo:   ${elapsed}ms`)
    if (error) {
        console.log(` ERRO:    ${error}`)
        return
    }
    console.log(` Página:  ${ads.length} anúncios  |  Total: ${total}  |  Páginas: ~${totalPages}`)
    console.log()

    if (!ads.length) {
        console.log(' Nenhum anúncio encontrado nesta página.')
        return
    }

    ads.forEach((ad, i) => {
        const price = ad.price ? `R$ ${ad.price.toLocaleString('pt-BR')}` : '(sem preço)'
        console.log(` [${String(i + 1).padStart(2)}] ${price.padEnd(16)} ${ad.title}`)
        console.log(`      ID: ${ad.id}`)
        console.log(`      ${ad.url}`)
        console.log()
    })

    const withPrice = ads.filter(a => a.price > 0)
    if (withPrice.length) {
        const avg = Math.round(withPrice.reduce((s, a) => s + a.price, 0) / withPrice.length)
        const min = Math.min(...withPrice.map(a => a.price))
        const max = Math.max(...withPrice.map(a => a.price))
        console.log(` Preços: mín R$${min.toLocaleString('pt-BR')}  |  máx R$${max.toLocaleString('pt-BR')}  |  média R$${avg.toLocaleString('pt-BR')}`)
    }
}

// ─── Main ──────────────────────────────────────────────────────────────────

const run = async () => {
    console.log('\n╔══════════════════════════════════════════════════════════╗')
    console.log('║         OLX + ZAP — Teste de Scraping Simultâneo        ║')
    console.log('╚══════════════════════════════════════════════════════════╝')

    await initializeCycleTLS()

    // Busca as duas URLs em paralelo
    console.log('\nBuscando OLX e ZAP em paralelo...')
    const [olxResult, zapResult] = await Promise.all([
        (async () => {
            const t = Date.now()
            try {
                const html = await $httpClient(OLX_URL)
                return { ...parseOlx(html), elapsed: Date.now() - t }
            } catch (e) {
                return { ads: [], error: e.message, elapsed: Date.now() - t }
            }
        })(),
        (async () => {
            const t = Date.now()
            try {
                const html = await $httpClient(ZAP_URL)
                return { ...parseZap(html), elapsed: Date.now() - t }
            } catch (e) {
                return { ads: [], error: e.message, elapsed: Date.now() - t }
            }
        })(),
    ])

    printResults({ label: 'OLX — Indaiatuba (todos os imóveis até R$600k)', url: OLX_URL, ...olxResult })
    printResults({ label: 'ZAP — Jardim Valença, Indaiatuba (3-4q até R$600k)', url: ZAP_URL, ...zapResult })

    console.log(`\n${'═'.repeat(60)}`)
    console.log(` Total geral: ${(olxResult.ads?.length || 0) + (zapResult.ads?.length || 0)} anúncios nesta página`)
    console.log(`${'═'.repeat(60)}\n`)

    process.exit(0)
}

run().catch(err => { console.error('Fatal:', err); process.exit(1) })
