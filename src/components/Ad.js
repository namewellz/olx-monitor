'use strict';

const notifier = require('./Notifier')
const $logger = require('./Logger')

const adRepository = require('../repositories/adRepository.js')

class Ad {

    constructor(ad) {
        this.id          = ad.id
        this.source      = ad.source || 'olx'
        this.url         = ad.url
        this.title       = ad.title
        this.searchTerm  = ad.searchTerm
        this.price       = ad.price
        this.description = ad.description || null
        this.valid       = false
        this.saved       = null,
        this.notify      = ad.notify
    }

    process = async () => {

        if (!this.isValidAd()) {
            $logger.debug('Ad not valid');
            return false
        }

        try {

            // check if this entry was already added to DB
            if (await this.alreadySaved()) {
                return this.checkPriceChange()
            }

            else {
                // create a new entry in the database
                return this.addToDataBase()
            }

        } catch (error) {
            $logger.error(error);
        }
    }

    alreadySaved = async () => {
        try {
            this.saved = await adRepository.getAd(this.id, this.source)
            return true
        } catch (error) {
            return false
        }
    }

    addToDataBase = async () => {
        try {
            await adRepository.createAd(this)
            $logger.info('Ad ' + this.id + ' added to the database')
        } catch (error) {
            $logger.error(error)
        }

        // Se notify=false (primeira execução da URL), suprime notificação
        // marcando o ad como já notificado logo após salvar
        if (!this.notify) {
            try { await adRepository.markAsNotified(this.id, this.source) } catch {}
        }
        // Se notify=true: o indexer processa o ad e, ao marcar hash_indexed=TRUE,
        // a fila do Notifier o enviará no próximo ciclo (a cada minuto)
    }

    updatePrice = async () => {
        $logger.info('updatePrice')

        try {
            await adRepository.updateAd(this)
        } catch (error) {
            $logger.error(error)
        }
    }

    checkPriceChange = async () => {

        if (this.price !== this.saved.price) {

            await this.updatePrice(this)

            // just send a notification if the price dropped
            if (this.price < this.saved.price) {

                $logger.info('This ad had a price reduction: ' + this.url)

                const decreasePercentage = Math.abs(Math.round(((this.price - this.saved.price) / this.saved.price) * 100))

                const msg = 'Price drop found! ' + decreasePercentage + '% OFF!\n' +
                    'From R$' + this.saved.price + ' to R$' + this.price + '\n\n' + this.url

                try {
                    await notifier.sendNotification(msg, this.id)
                } catch (error) {
                    $logger.error(error)
                }
            }
        }
    }

    // some elements found in the ads selection don't have an url
    // I supposed that OLX adds other content between the ads,
    // let's clean those empty ads
    isValidAd = () => {

        if (!isNaN(this.price) && this.url && this.id) {
            this.valid = true
            return true
        }
        else {
            this.valid = false
            return false
        }
    }
}

module.exports = Ad
