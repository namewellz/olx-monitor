'use strict';
const config = require('../config');
const axios = require('axios');
const adRepository = require('../repositories/adRepository');
const $logger = require('./Logger');

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const sendWithRetry = async (url, retries = 3) => {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            await axios.get(url, { timeout: 10000 });
            return true;
        } catch (err) {
            $logger.error(`Attempt ${attempt}/${retries} failed: ${err.message}`);
            if (attempt < retries) {
                const waitTime = attempt * 2000;
                $logger.error(`Retrying in ${waitTime / 1000}s...`);
                await delay(waitTime);
            }
        }
    }
    return false;
};

exports.sendNotification = async (msg, adId, source) => {
    if (process.env.DISABLE_NOTIFICATIONS === 'true') {
        $logger.info(`[NOTIFICATIONS DISABLED] Skipping: ${msg.substring(0, 60)}`)
        return
    }
    try {
        const apiUrl = `https://api.telegram.org/bot${config.telegramToken}/sendMessage?chat_id=${config.telegramChatID}&text=`;
        const encodedMsg = encodeURIComponent(msg);
        const success = await sendWithRetry(apiUrl + encodedMsg);

        if (success) {
            if (adId && source) await adRepository.markAsNotified(adId, source);
            $logger.info(`Notification sent for ad ${adId} [${source}]`);
        } else {
            $logger.error(`Failed to notify ad ${adId} [${source}] - will retry on next run`);
        }

        await delay(1500);
    } catch (err) {
        $logger.error(`Unexpected error sending notification: ${err.message}`);
    }
};

exports.processPendingNotifications = async () => {
    try {
        const pending = await adRepository.getPendingNotifications();

        if (pending.length === 0) return;

        $logger.info(`Processing ${pending.length} pending notifications`);

        const batch = pending.slice(0, 10);

        for (const ad of batch) {
            const source = (ad.source || 'olx').toUpperCase()
            const msg = `[${source}] New ad found!\n${ad.title}\nR$${Number(ad.price).toLocaleString('pt-BR')}\n\n${ad.url}`;
            await exports.sendNotification(msg, ad.id, ad.source);
        }

        const remaining = pending.length - batch.length;
        if (remaining > 0) {
            $logger.info(`${remaining} notifications remaining for next run`);
        }
    } catch (err) {
        $logger.error(`Error processing pending notifications: ${err.message}`);
    }
};