<img alt="OLX Monitor" src="assets/olx-monitor-banner.png"></img>

# OLX Monitor

Estava procurando um imóvel no OLX e no ZAP Imóveis, e diariamente acessava minhas buscas salvas à procura de uma boa oportunidade. Um dia encontrei uma ótima oferta, mas quando entrei em contato já era tarde — o vendedor estava indo ao encontro de outro comprador e havia mais três pessoas na fila.

Vi nessa situação uma oportunidade para aprender sobre scraping com `Node.js` e não perder a próxima. O projeto evoluiu para monitorar múltiplas fontes simultaneamente, enviar notificações pelo Telegram e contar com uma interface administrativa própria.

---

## Funcionalidades

- Monitora **OLX** e **ZAP Imóveis** simultaneamente
- Detecta **novos anúncios** e **quedas de preço** e notifica via Telegram
- Fila de notificações com **retry automático** (até 3 tentativas com backoff)
- **Rate limiting** entre notificações para evitar bloqueios da API do Telegram
- Banco de dados **PostgreSQL** com chave composta `(id, source)` para evitar colisões entre plataformas
- **Interface administrativa** web para acompanhar anúncios, logs e configurações
- Suporte a múltiplas URLs de busca por fonte
- Facilmente extensível para novas fontes (VivaReal, Imovelweb, etc.)

---

## Arquitetura

```
src/
  components/
    BaseScraper.js    ← loop de paginação, stats e logs (compartilhado)
    ScraperOLX.js     ← parser específico do OLX (__NEXT_DATA__)
    ScraperZAP.js     ← parser específico do ZAP (JSON-LD + fallback HTML)
    Ad.js             ← validação, persistência e notificação por anúncio
    Notifier.js       ← envio Telegram com retry e fila de pendentes
    HttpClient.js     ← cliente HTTP com fingerprint TLS anti-bot
    Logger.js
    CycleTls.js
  database/
    database.js       ← criação de tabelas e migrações (PostgreSQL)
  repositories/
    adRepository.js
    scrapperRepository.js
  api/
    server.js         ← servidor Express com API REST
  ui/
    index.html        ← interface administrativa (SPA Alpine.js)
    css/app.css       ← design system inspirado no Portainer
    js/app.js         ← lógica da interface
  tests/
    test-zap.js       ← teste isolado do ZAP (sem DB/Telegram)
    test-both.js      ← teste lado a lado OLX + ZAP
  index.js
  migrate-sqlite-to-pg.js  ← script de migração de dados SQLite → PostgreSQL
  config.js                ← suas configurações (ignorado pelo git)
  sample-config.js         ← exemplo de configuração
```

---

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

Express (porta 3000)
  └─ Serve a interface administrativa
  └─ API REST /api/* para dados e controle
```

---

## Instalação

### Pré-requisitos

- Docker e Docker Compose
- Conta no [Telegram](https://telegram.org/) com um bot criado

### Usando Docker Compose (recomendado)

O `docker-compose.yml` já inclui o serviço do PostgreSQL. Basta seguir os passos:

**1. Clone o repositório:**
```bash
git clone https://github.com/namewellz/olx-monitor.git
cd olx-monitor
```

**2. Crie o arquivo `.env` em `src/`:**
```bash
cp src/sample-config.js src/config.js
```

```env
# src/.env
TELEGRAM_TOKEN=seu_token_aqui
TELEGRAM_CHAT_ID=seu_chat_id_aqui
```

**3. Configure suas URLs em `src/config.js`** (veja seção [Configuração das buscas](#configuração-das-buscas)).

**4. Suba os serviços:**
```bash
docker-compose up -d
```

O Postgres sobe primeiro. O monitor aguarda o healthcheck antes de conectar. A interface administrativa fica disponível em **http://localhost:3000**.

**5. Acompanhe os logs:**
```bash
docker-compose logs -f olx-monitor
```

---

### Variáveis de ambiente

| Variável | Padrão | Descrição |
|---|---|---|
| `PGHOST` | `localhost` | Host do PostgreSQL |
| `PGPORT` | `5432` | Porta do PostgreSQL |
| `PGUSER` | `olxmonitor` | Usuário do banco |
| `PGPASSWORD` | `olxmonitor` | Senha do banco |
| `PGDATABASE` | `olxmonitor` | Nome do banco |
| `DISABLE_NOTIFICATIONS` | — | Se `true`, suprime todos os envios ao Telegram (útil em testes) |

As variáveis PG já estão configuradas no `docker-compose.yml`. Para ambientes externos (VPS, cloud), basta ajustá-las.

---

### Usando Node diretamente (sem Docker)

Requer PostgreSQL instalado e rodando localmente.

```bash
cd olx-monitor/src
npm install
# configure src/.env e src/config.js
node index.js
```

Para subir apenas a interface sem o scraper (modo visualização):
```bash
node ui-dev.js
```

---

## Configuração do Telegram

### Criando o bot

Use o [@BotFather](https://t.me/BotFather) no Telegram para criar um bot e obter o `TELEGRAM_TOKEN`.

### Descobrindo o Chat ID

1. Crie um grupo no Telegram e adicione seu bot e o [@myidbot](https://t.me/myidbot)
2. Digite `/getgroupid@myidbot` no grupo
3. O bot responderá com o `CHAT_ID` — use esse valor em `TELEGRAM_CHAT_ID`

---

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

// Porta da interface administrativa (padrão: 3000)
config.uiPort = 3000
```

> **Dica:** Quanto mais específica for a URL de busca, mais eficiente o monitor será. Prefira buscas já filtradas por bairro, tipo de imóvel, faixa de preço e número de quartos.

> **Compatibilidade:** A chave `config.urls` (nome antigo) ainda é aceita como fallback de `config.olxUrls`.

---

## Banco de dados

O projeto usa **PostgreSQL**. As tabelas são criadas automaticamente na primeira execução.

### Estrutura

**Tabela `ads`**

| Coluna | Descrição |
|---|---|
| `id` | ID do anúncio na plataforma de origem |
| `source` | Origem: `olx` ou `zap` |
| `searchTerm` | Termo/caminho da busca que encontrou o anúncio |
| `title` | Título do anúncio |
| `price` | Preço em valor inteiro |
| `url` | Link direto para o anúncio |
| `notified` | `0` = pendente, `1` = notificação enviada |
| `created` | Data de criação |
| `lastUpdate` | Data da última atualização |

Chave primária composta: `(id, source)` — evita colisões entre plataformas com IDs numéricos coincidentes.

**Tabela `logs`**

Registra estatísticas de cada varredura: URL pesquisada, quantidade de anúncios encontrados, preço médio, mínimo e máximo.

**Tabela `search_urls`** *(gerenciada pela interface)*

URLs de busca cadastradas via interface administrativa, com suporte a ativar/desativar sem reiniciar o serviço.

---

## Migrando de SQLite para PostgreSQL

Se você usava uma versão anterior do projeto com SQLite, utilize o script de migração para transferir todos os dados:

**1. Certifique-se de que o PostgreSQL está rodando:**
```bash
docker-compose up -d postgres
```

**2. Instale o sqlite3 temporariamente:**
```bash
cd src
npm install sqlite3 --no-save
```

**3. Execute o script apontando para o arquivo do banco antigo:**
```bash
node migrate-sqlite-to-pg.js ../data/ads.db
```

**Saída esperada:**
```
📦 Fonte SQLite : ../data/ads.db
🐘 Destino PG   : localhost:5432/olxmonitor

📋 Anúncios encontrados : 380
📋 Logs encontrados     : 572

✅ Ads   : 380 migrados
✅ Logs  : 572 migrados

✨ Migração concluída com sucesso!
```

O script usa `ON CONFLICT DO NOTHING` — pode ser executado mais de uma vez sem duplicar registros.

---

## Interface administrativa

Acesse **http://localhost:3000** após subir os serviços.

| Página | Descrição |
|---|---|
| **Dashboard** | Visão geral: contadores, últimas notificações, status do sistema |
| **URLs Monitoradas** | Cadastro e gerenciamento de URLs por fonte (OLX/ZAP) |
| **Anúncios** | Listagem completa com filtros por fonte e status de notificação |
| **Configurações** | Intervalo de varredura, credenciais Telegram e teste de envio |
| **Logs** | Histórico de varreduras com estatísticas de preço |

---

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

---

## Considerações

- O script usa **CycleTLS** para simular fingerprints TLS de navegadores reais, reduzindo o risco de bloqueio por detecção de bot.
- O **OLX** injeta os dados via `__NEXT_DATA__` (Next.js). O **ZAP Imóveis** usa um JSON-LD Schema.org (`ItemList`) embutido na página, com fallback para parsing HTML caso a estrutura mude.
- O notificador roda em cron **independente** do scraper — se uma notificação falhar, ela será retentada automaticamente no próximo minuto.
- Testado apenas na versão brasileira das plataformas.
