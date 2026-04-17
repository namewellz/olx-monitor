require('dotenv').config()

let config = {}

config.urls = [
    'https://www.olx.com.br/imoveis/venda/estado-sp/grande-campinas/indaiatuba?pe=600000&sf=1&ret=1040'
]

config.zapUrls = [
    'https://www.zapimoveis.com.br/venda/casas/sp+indaiatuba/?onde=%2CS%C3%A3o+Paulo%2CIndaiatuba%2C%2C%2C%2C%2Ccity%2CBR%3ESao+Paulo%3ENULL%3EIndaiatuba&tipos=casa_residencial&quartos=3%2C4&precoMaximo=600000'
]

// this tool can help you create the interval string:
// https://tool.crontap.com/cronjob-debugger

config.interval = '*/5 * * * *' 
config.telegramChatID = process.env.TELEGRAM_CHAT_ID
config.telegramToken = process.env.TELEGRAM_TOKEN
config.dbFile = '../data/ads.db'

config.logger={
    logFilePath: '../data/scrapper.log',
    timestampFormat:'YYYY-MM-DD HH:mm:ss'
}

module.exports = config