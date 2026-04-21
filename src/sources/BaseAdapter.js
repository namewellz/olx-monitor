'use strict'

/**
 * Contrato que todo adaptador de fonte deve implementar.
 * Adicionar nova fonte = criar subclasse + registrar em sources/index.js.
 */
class BaseAdapter {
  /** Identificador da fonte — deve coincidir com ads.source */
  get source() { throw new Error('source not implemented') }

  /**
   * Dado um ad (row da tabela ads), retorna array de URLs de imagem.
   * Pode fazer requisição HTTP se necessário.
   * @param {object} ad
   * @returns {Promise<string[]>}
   */
  async extractImageUrls(ad) { throw new Error('extractImageUrls not implemented') }
}

module.exports = BaseAdapter
