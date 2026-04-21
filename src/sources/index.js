'use strict'
const OLXAdapter = require('./OLXAdapter')
const ZAPAdapter = require('./ZAPAdapter')

/**
 * Registry de adaptadores por source.
 * Para adicionar uma nova fonte: criar o adaptador e registrá-lo aqui.
 */
module.exports = {
  olx: new OLXAdapter(),
  zap: new ZAPAdapter(),
}
