<img alt="OLX Monitor" src="assets/olx-monitor-banner.png"></img>

# OLX Monitor

Estava procurando um imóvel no OLX e no ZAP Imóveis, e diariamente acessava minhas buscas salvas à procura de uma boa oportunidade. Um dia encontrei uma ótima oferta, mas quando entrei em contato já era tarde — o vendedor estava indo ao encontro de outro comprador e havia mais três pessoas na fila.

Vi nessa situação uma oportunidade para aprender sobre scraping com `Node.js` e não perder a próxima. O projeto evoluiu para monitorar múltiplas fontes simultaneamente e enviar notificações pelo Telegram assim que um novo anúncio é encontrado ou um preço cai.

## Funcionalidades

- Monitora **OLX** e **ZAP Imóveis** simultaneamente
- Detecta **novos anúncios** e **quedas de preço** e notifica via Telegram
- Fila de notificações com **retry automático** (até 3 tentativas com backoff)
- **Rate limiting** entre notificações para evitar bloqueios da API do Telegram
- Banco de dados SQLite com coluna `source` para diferenciar anúncios de cada plataforma
- Suporte a múltiplas URLs de busca por fonte
- Facilmente extensível para novas fontes (VivaReal, Imovelweb, etc.)

## Arquitetura

```
src/
  components/
    BaseScraper.js    ← loop de paginação, stats e logs (compartilhado)
    ScraperOLX.js     ← parser específico do OLX (__NEXT_DATA__)
    ScraperZAP.js     ← parser específico do ZAP (JSON-LD + fallback HTML)
    Ad.js             ← lógica de validação, persistência e notificação
    Notifier.js       ← envio Telegram com retry e fila de pendentes
    HttpClient.js     ← cliente HTTP com fingerprint TLS anti-bot
    Logger.js
    CycleTls.js
  database/
    database.js       ← criação de tabelas e migrações
  repositories/
    adRepository.js
    scrapperRepository.js
  tests/
    test-zap.js       ← teste isolado do ZAP (sem DB/Telegram)
    test-both.js      ← teste lado a lado OLX + ZAP
  index.js
  config.js           ← suas configurações (ignorado pelo git)
  sample-config.js    ← exemplo de configuração
```

## Fluxo de funcionamento

```
cron (config.interval)
  └─ ScraperOLX → varre cada URL em config.olxUrls
  └─ ScraperZAP → varre cada URL em config.zapUrls
        └─ Para cada anúncio encontrado:
              ├─ Novo?      → salva no banco (notified=0)
              └─ Já existe? → verifica queda de preço → atualiza banco

cron (a cada 1 minuto)
  └─ processPendingNotifications
        └─ Busca anúncios com notified=0, envia em lotes de 10
              └─ Sucesso? → marca notified=1
              └─ Falha?   → retry na próxima rodada (até 3 tentativas)
```

## Instalação

### Pré-requisitos

- Node.js 20+
- npm
- Conta no [Telegram](https://telegram.org/) com um bot criado

### Usando Node

1. Clone o repositório:
   ```bash
   git clone https://github.com/namewellz/olx-monitor.git
   cd olx-monitor/src
   ```

2. Instale as dependências:
   ```bash
   npm install
   ```

3. Crie o arquivo `.env` na pasta `src/` com as credenciais do Telegram:
   ```
   TELEGRAM_TOKEN=seu_token_aqui
   TELEGRAM_CHAT_ID=seu_chat_id_aqui
   ```

4. Crie o arquivo `config.js` baseado no `sample-config.js` e configure suas URLs e preferências.

5. Execute:
   ```bash
   node index.js
   ```

6. Os arquivos de dados serão criados automaticamente em `data/`:
   - `ads.db` — banco de dados SQLite
   - `scrapper.log` — logs de execução

### Usando Docker

1. Realize os passos 1 a 4 do guia acima.
2. Na primeira vez, faça o build da imagem:
   ```bash
   docker-compose build
   ```
3. Nas próximas execuções:
   ```bash
   docker-compose up
   ```

## Configuração do Telegram

### Criando o bot

Use o [@BotFather](https://t.me/BotFather) no Telegram para criar um bot e obter o `TELEGRAM_TOKEN`.

### Descobrindo o Chat ID

1. Crie um grupo no Telegram e adicione seu bot e o [@myidbot](https://t.me/myidbot)
2. Digite `/getgroupid@myidbot` no grupo
3. O bot responderá com o `CHAT_ID` — use esse valor em `TELEGRAM_CHAT_ID`

## Configuração das buscas

Copie `sample-config.js` para `config.js` e edite conforme sua necessidade:

```js
// URLs do OLX — copie diretamente do site com seus filtros aplicados
config.olxUrls = [
    'https://www.olx.com.br/imoveis/venda/casas/estado-sp/grande-campinas/indaiatuba?pe=600000&q=jardim%20valenca',
]

// URLs do ZAP Imóveis — copie diretamente do site com seus filtros aplicados
config.zapUrls = [
    'https://www.zapimoveis.com.br/venda/casas/sp+indaiatuba/?tipos=casa_residencial&quartos=3%2C4&precoMaximo=600000',
]

// Intervalo de varredura (padrão: a cada 5 minutos)
config.interval = '*/5 * * * *'

// true  → notifica todos os anúncios encontrados na primeira execução
// false → só notifica anúncios novos a partir da segunda execução
config.notifyOnFirstRun = false
```

### Dica

Quanto mais específica for a URL de busca, mais eficiente o monitor será. URLs com muitos resultados geram mais requisições e mais notificações. Prefira buscas já filtradas por bairro, tipo de imóvel, faixa de preço e número de quartos.

## Banco de dados

Os anúncios são salvos em SQLite com a seguinte estrutura:

| Coluna       | Descrição                                      |
|--------------|------------------------------------------------|
| `id`         | ID do anúncio na plataforma de origem          |
| `source`     | Origem do anúncio: `olx` ou `zap`              |
| `searchTerm` | Termo/caminho da busca que encontrou o anúncio |
| `title`      | Título do anúncio                              |
| `price`      | Preço em valor inteiro                         |
| `url`        | Link direto para o anúncio                     |
| `notified`   | `0` = pendente, `1` = notificação enviada      |
| `created`    | Data de criação                                |
| `lastUpdate` | Data da última atualização                     |

A chave primária é composta por `(id, source)` para evitar colisões entre plataformas que podem ter IDs numéricos coincidentes.

## Adicionando uma nova fonte

Graças ao `BaseScraper`, adicionar uma nova plataforma requer apenas criar um arquivo com o parser específico:

```js
// src/components/ScraperVivaReal.js
const { createScraper } = require('./BaseScraper')

module.exports = {
    scraper: createScraper({
        source: 'vivareal',
        getSearchTerm: (url) => { /* extrai termo da URL */ },
        setPageParam:  (url, page) => { /* adiciona parâmetro de paginação */ },
        parsePage:     ($, page) => { /* retorna { ads, nextPage } */ },
    })
}
```

Depois basta registrar em `index.js` e adicionar `config.vivarealUrls` no `config.js`.

## Considerações

- O script usa **CycleTLS** para simular fingerprints TLS de navegadores reais, reduzindo o risco de bloqueio por detecção de bot.
- O **OLX** injeta os dados via `__NEXT_DATA__` (Next.js). O **ZAP Imóveis** usa um JSON-LD Schema.org (`ItemList`) embutido na página, com fallback para parsing HTML caso a estrutura mude.
- O notificador roda em cron **independente** do scraper — se uma notificação falhar, ela será retentada automaticamente no próximo minuto.
- Testado apenas na versão brasileira das plataformas.
