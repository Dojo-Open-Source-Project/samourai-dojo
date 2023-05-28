/*!
 * tracker/transactions-cache.js
 * Copyright © 2023 – Katana Cryptographic Ltd. All Rights Reserved.
 */

import QuickLRU from 'quick-lru'

/**
 * Cache of txids, for avoiding triple-check behavior.
 * ZMQ sends the transaction twice:
 * 1. When it enters the mempool
 * 2. When it leaves the mempool (mined or orphaned)
 * Additionally, the transaction comes in a block
 * Orphaned transactions are deleted during the routine check
 */
export const TransactionsCache = new QuickLRU({
    // Maximum number of txids to store in cache
    maxSize: 100000,
    // Maximum age for items in the cache.
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
})
