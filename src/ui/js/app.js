function app() {
  return {
    // ── Navigation ────────────────────────────────────────
    page: 'dashboard',
    urlTab: 'all',

    // ── Data ──────────────────────────────────────────────
    stats: { total: 0, pending: 0, notified: 0, activeUrls: 0, olxCount: 0, zapCount: 0 },
    status: { running: true, interval: '*/5 * * * *', nextRun: '--:--', telegram: false },
    recentAds: [],
    lastLog: null,
    ads: [],
    logs: [],
    urls: [],
    running: false,

    // ── Filters & sort ────────────────────────────────────
    adsFilter: { source: '', notified: '' },
    adsSort: { col: 'created', dir: 'desc' },

    // ── Settings ──────────────────────────────────────────
    settings: {
      interval: '*/5 * * * *',
      notifyOnFirstRun: false,
      telegramToken: '',
      telegramChatId: '',
      telegramChatIdZap: '',
      telegramTokenOk: false,
    },
    telegramTest: null,

    // ── Modal ─────────────────────────────────────────────
    modal: { open: false, editId: null, source: 'olx', label: '', url: '' },

    // ── Lifecycle ─────────────────────────────────────────
    async init() {
      await Promise.all([
        this.loadStats(),
        this.loadStatus(),
        this.loadRecentAds(),
        this.loadLastLog(),
        this.loadUrls(),
        this.loadSettings(),
      ])
      // Auto-refresh every 30s
      setInterval(() => {
        this.loadStats()
        this.loadStatus()
        this.loadRecentAds()
        this.loadLastLog()
      }, 30_000)
    },

    navigate(p) {
      this.page = p
      if (p === 'ads') this.loadAds()
      if (p === 'logs') this.loadLogs()
    },

    pageTitle() {
      const titles = {
        dashboard: 'Dashboard',
        urls: 'URLs Monitoradas',
        ads: 'Anúncios',
        settings: 'Configurações',
        logs: 'Logs',
      }
      return titles[this.page] || ''
    },

    // ── API helpers ───────────────────────────────────────
    async api(path, opts = {}) {
      const res = await fetch('/api' + path, {
        headers: { 'Content-Type': 'application/json' },
        ...opts,
        body: opts.body ? JSON.stringify(opts.body) : undefined,
      })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },

    // ── Loaders ───────────────────────────────────────────
    async loadStats() {
      try { Object.assign(this.stats, await this.api('/stats')) } catch {}
    },
    async loadStatus() {
      try { Object.assign(this.status, await this.api('/status')) } catch {}
    },
    async loadRecentAds() {
      try { this.recentAds = await this.api('/ads?limit=8&order=desc') } catch {}
    },
    async loadLastLog() {
      try {
        const logs = await this.api('/logs?limit=1&order=desc')
        this.lastLog = logs[0] || null
      } catch {}
    },
    async loadAds() {
      try {
        const params = new URLSearchParams()
        if (this.adsFilter.source) params.set('source', this.adsFilter.source)
        if (this.adsFilter.notified !== '') params.set('notified', this.adsFilter.notified)
        params.set('limit', 100)
        this.ads = await this.api('/ads?' + params)
      } catch {}
    },
    async loadLogs() {
      try { this.logs = await this.api('/logs?limit=50&order=desc') } catch {}
    },
    async loadUrls() {
      try { this.urls = await this.api('/urls') } catch {}
    },
    async loadSettings() {
      try { Object.assign(this.settings, await this.api('/settings')) } catch {}
    },

    // ── Actions ───────────────────────────────────────────
    async runNow() {
      if (this.running) return
      this.running = true
      try {
        await this.api('/run', { method: 'POST' })
        setTimeout(() => {
          this.loadStats()
          this.loadRecentAds()
          this.loadLastLog()
        }, 3000)
      } catch {}
      this.running = false
    },

    async saveSettings() {
      try {
        await this.api('/settings', { method: 'PUT', body: this.settings })
        this.showToast('Configurações salvas')
      } catch { this.showToast('Erro ao salvar', true) }
    },

    async testTelegram() {
      this.telegramTest = null
      try {
        const res = await this.api('/telegram/test', { method: 'POST' })
        this.telegramTest = { ok: true, msg: '✓ Mensagem de teste enviada com sucesso!' }
      } catch (e) {
        this.telegramTest = { ok: false, msg: '✗ Falha: ' + e.message }
      }
    },

    // ── URL management ────────────────────────────────────
    filteredUrls() {
      if (this.urlTab === 'all') return this.urls
      return this.urls.filter(u => u.source === this.urlTab)
    },
    urlsBySource(src) {
      return this.urls.filter(u => u.source === src)
    },

    openAddUrl() {
      this.modal = { open: true, editId: null, source: 'olx', label: '', url: '' }
    },
    editUrl(url) {
      this.modal = { open: true, editId: url.id, source: url.source, label: url.label || '', url: url.url }
    },
    async saveUrl() {
      if (!this.modal.url.trim()) return
      try {
        if (this.modal.editId) {
          await this.api('/urls/' + this.modal.editId, {
            method: 'PUT',
            body: { source: this.modal.source, label: this.modal.label, url: this.modal.url },
          })
        } else {
          await this.api('/urls', {
            method: 'POST',
            body: { source: this.modal.source, label: this.modal.label, url: this.modal.url, active: true },
          })
        }
        this.modal.open = false
        await this.loadUrls()
        await this.loadStats()
      } catch {}
    },
    async deleteUrl(url) {
      if (!confirm('Remover esta URL?')) return
      try {
        await this.api('/urls/' + url.id, { method: 'DELETE' })
        await this.loadUrls()
        await this.loadStats()
      } catch {}
    },
    async toggleUrl(url) {
      try {
        await this.api('/urls/' + url.id, {
          method: 'PUT',
          body: { ...url, active: !url.active },
        })
        await this.loadUrls()
        await this.loadStats()
      } catch {}
    },

    // ── Ads sorting ───────────────────────────────────────
    sortBy(col) {
      if (this.adsSort.col === col) {
        this.adsSort.dir = this.adsSort.dir === 'asc' ? 'desc' : 'asc'
      } else {
        this.adsSort.col = col
        this.adsSort.dir = col === 'created' ? 'desc' : 'asc'
      }
    },
    sortedAds() {
      const { col, dir } = this.adsSort
      return [...this.ads].sort((a, b) => {
        let va = a[col], vb = b[col]
        if (col === 'price') { va = Number(va); vb = Number(vb) }
        else { va = String(va ?? '').toLowerCase(); vb = String(vb ?? '').toLowerCase() }
        if (va < vb) return dir === 'asc' ? -1 : 1
        if (va > vb) return dir === 'asc' ?  1 : -1
        return 0
      })
    },
    sortIcon(col) {
      if (this.adsSort.col !== col) return '↕'
      return this.adsSort.dir === 'asc' ? '↑' : '↓'
    },

    // ── Formatters ────────────────────────────────────────
    formatPrice(val) {
      if (!val && val !== 0) return '–'
      return 'R$ ' + Number(val).toLocaleString('pt-BR')
    },
    formatDate(val) {
      if (!val) return '–'
      const d = new Date(val)
      if (isNaN(d)) return val
      return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    },

    // ── Toast (simple) ────────────────────────────────────
    showToast(msg, isError = false) {
      // minimal: just a console log for now; can be enhanced later
      console.log(msg)
    },
  }
}
