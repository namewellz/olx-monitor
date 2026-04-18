require('dotenv').config()

let config = {}

// ── Intervalo de varredura ─────────────────────────────────────
// Gerador de expressões cron: https://tool.crontap.com/cronjob-debugger
config.interval = '*/5 * * * *'

// ── Telegram ───────────────────────────────────────────────────
config.telegramChatID = process.env.TELEGRAM_CHAT_ID
config.telegramToken  = process.env.TELEGRAM_TOKEN

// ── Notificações ───────────────────────────────────────────────
// true  → notifica todos os anúncios encontrados na primeira execução
// false → só notifica anúncios novos a partir da segunda execução
config.notifyOnFirstRun = false

// ── Interface administrativa ───────────────────────────────────
config.uiPort = 3000

// ── Logger ─────────────────────────────────────────────────────
config.logger = {
  logFilePath:     '/usr/data/scrapper.log',
  timestampFormat: 'YYYY-MM-DD HH:mm:ss',
}

// ── URLs de busca ──────────────────────────────────────────────
// As URLs são gerenciadas pelo banco de dados e pela interface em /urls.
// Na primeira execução, se o banco estiver vazio, as listas abaixo são
// importadas automaticamente como seed inicial.
// Após isso, adicione, edite ou desative URLs pela interface.
config.olxUrls = [
  // 'https://www.olx.com.br/imoveis/venda/estado-sp/grande-campinas/indaiatuba?pe=600000&sf=1&ret=1040',
]

config.zapUrls = [
  // 'https://www.zapimoveis.com.br/venda/casas/sp+indaiatuba/?tipos=casa_residencial&quartos=3%2C4&precoMaximo=600000',
]

module.exports = config
