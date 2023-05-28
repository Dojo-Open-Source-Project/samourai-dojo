/*!
 * scripts/delete-data-banned-addresses.js
 * Copyright © 2019 – Katana Cryptographic Ltd. All Rights Reserved.
 */



import Logger from '../lib/logger.js'
import util from '../lib/util.js'
import db from '../lib/db/mysql-db-wrapper.js'


/**
 * Script deleting all data related to addresses registered in the ban list
 */

async function getBannedAddresses() {
    const query = 'SELECT `addrAddress` FROM `banned_addresses`'
    return db._query(query)
}


async function deleteAddress(address) {
    const addr = address.addrAddress
    Logger.info(`Start deletion of address ${addr}`)
    const query = 'DELETE `addresses`.* FROM `addresses` WHERE `addresses`.`addrAddress` = ?'
    const ret = await db._query(query, [addr])
    Logger.info(`Completed deletion of address ${addr}`)
    return ret
}


async function getUnlinkedTransactions() {
    const query =
        'SELECT `transactions`.`txnTxid` \
         FROM `transactions` \
         WHERE `transactions`.`txnID` NOT IN (SELECT `outputs`.`txnID` FROM `outputs`) \
         AND `transactions`.`txnID` NOT IN (SELECT `inputs`.`txnID` FROM `inputs`)'

    return db._query(query)
}


async function deleteTransaction(tx) {
    const txid = tx.txnTxid
    Logger.info(`Start deletion of transaction ${txid}`)
    await db.deleteTransaction(txid)
    Logger.info(`Completed deletion of transaction ${txid}`)
}


async function run() {
    // Get a list of banned addresses
    const addresses = await getBannedAddresses()
    // Delete addresses, outputs, inputs
    // related to a banned address
    await util.seriesCall(addresses, deleteAddress)
    // Get a list of unlinked transactions
    const txs = await getUnlinkedTransactions()
    // Deletes the transactions
    await util.seriesCall(txs, deleteTransaction)
}


/**
 * Launch the script
 */

Logger.info('Start processing')

setTimeout(async () => {
    return run().then(() => {
        Logger.info('Processing completed')
    })
}, 1500)

