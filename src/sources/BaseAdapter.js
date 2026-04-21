'use strict'

/**
 * Contrato que todo adaptador de fonte deve implementar.
 * Adicionar nova fonte = criar subclasse + registrar em sources/index.js.
 */
class BaseAdapter {
  /** Identificador da fonte — deve coincidir com ads.source */
  get source() { throw new Error('source not implemented') }

  /**
   * Dado um ad (row da tabela ads), retorna imagens e descrição extraídas da página individual.
   * Uma única requisição HTTP serve para ambos os dados.
   * @param {object} ad
   * @returns {Promise<{ imageUrls: string[], description: string|null }>}
   */
  async extractAdData(ad) { throw new Error('extractAdData not implemented') }
}

module.exports = BaseAdapter
