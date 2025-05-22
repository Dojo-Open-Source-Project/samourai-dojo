// eslint-disable-next-line no-unused-vars
const lib_api = {

    /**
     * Base URI
     */
    baseUri: conf.api.baseUri,

    /**
     * Authentication
     */
    signin: (data) => {
        let uri = `${lib_api.baseUri}/auth/login`
        return lib_api.sendPostUriEncoded(uri, data)
    },

    /**
     * Gets a new access token
     */
    refreshToken: (data) => {
        let uri = `${lib_api.baseUri}/auth/refresh`
        return lib_api.sendPostUriEncoded(uri, data)
    },

    /**
     * Get new AUTH47 URI
     */
    getAuth47Uri: () => {
        const uri = `${lib_api.baseUri}/auth/auth47/uri`
        return lib_api.sendGetJson(uri, {})
    },

    /**
     * Get status of AUTH47 request
     * @param nonce {string}
     */
    getAuth47Status: (nonce) => {
        const uri = `${lib_api.baseUri}/auth/auth47/status/${nonce}`
        return lib_api.sendGetJson(uri, {})
    },

    /**
     * API Status
     */
    getApiStatus: () => {
        let prefix = conf.prefixes.status
        let uri = `${lib_api.baseUri}/${prefix}`
        return lib_api.sendGetUriEncoded(uri, {})
    },

    /**
     * Get pairing info
     */
    getPairingInfo: () => {
        let prefix = conf.prefixes.support
        let uri = `${lib_api.baseUri}/${prefix}/pairing`
        return lib_api.sendGetUriEncoded(uri, {})
    },

    /**
     * Get API keys
     * @returns {Promise<{ apikeyID: number, label: string, apikey: string, active: boolean, createdAt: string, expiresAt: string }[]>}
     */
    getApiKeys: () => {
        let prefix = conf.prefixes.support
        let uri = `${lib_api.baseUri}/${prefix}/apikeys`
        return lib_api.sendGetUriEncoded(uri)
    },

    /**
     * Create a new API key
     * @param {object} args
     * @param {string} args.label
     * @param {Date} args.expiresAt
     * @returns {Promise<any | never>}
     */
    createApiKey: (args) => {
        let prefix = conf.prefixes.support
        let uri = `${lib_api.baseUri}/${prefix}/apikey`
        return lib_api.sendPostJson(uri, args)
    },

    /**
     * Update an API key
     * @param {string} key
     * @param {object} args
     * @param {string} args.label
     * @param {Date} args.expiresAt
     * @param {boolean} args.active
     * @returns {Promise<any | never>}
     */
    updateApiKey: (key, args) => {
        let prefix = conf.prefixes.support
        let uri = `${lib_api.baseUri}/${prefix}/apikey/${key}`
        return lib_api.sendPatchJson(uri, args)
    },

    /**
     * Delete an API key
     * @param {string} key
     * @returns {Promise<any | never>}
     */
    deleteApiKey: (key) => {
        let prefix = conf.prefixes.support
        let uri = `${lib_api.baseUri}/${prefix}/apikey/${key}`
        return lib_api.sendDelete(uri)
    },

    /**
     * PushTx Status
     */
    getPushtxStatus: () => {
        let prefix = conf.prefixes.statusPushtx
        let uri = `${lib_api.baseUri}/pushtx/${prefix}`
        //let uri = 'http://127.0.0.1:8081/' + prefix
        return lib_api.sendGetUriEncoded(uri, {})
    },

    /**
     * Orchestrztor Status
     */
    getOrchestratorStatus: () => {
        let prefix = conf.prefixes.statusPushtx
        let uri = `${lib_api.baseUri}/pushtx/${prefix}/schedule`
        //let uri = 'http://127.0.0.1:8081/' + prefix + '/schedule'
        return lib_api.sendGetUriEncoded(uri, {})
    },

    /**
     * Gets information about an address
     */
    getAddressInfo: (address) => {
        let prefix = conf.prefixes.support
        let uri = `${lib_api.baseUri}/${prefix}/address/${address}/info`
        return lib_api.sendGetUriEncoded(uri, {})
    },

    /**
     * Rescans an address
     */
    getAddressRescan: (address) => {
        let prefix = conf.prefixes.support
        let uri = `${lib_api.baseUri}/${prefix}/address/${address}/rescan`
        return lib_api.sendGetUriEncoded(uri, {})
    },

    /**
     * Gets information about a xpub
     */
    getXpubInfo: (xpub) => {
        let prefix = conf.prefixes.support
        let uri = `${lib_api.baseUri}/${prefix}/xpub/${xpub}/info`
        return lib_api.sendGetUriEncoded(uri, {})
    },

    /**
     * Rescans a xpub
     */
    getXpubRescan: (xpub, nbAddr, startIdx) => {
        let prefix = conf.prefixes.support
        let uri = `${lib_api.baseUri}/${prefix}/xpub/${xpub}/rescan`
        return lib_api.sendGetUriEncoded(
            uri,
            {
                'gap': nbAddr,
                'startidx': startIdx
            }
        )
    },

    /**
     * Deletes a xpub
     */
    getXpubDelete: (xpub) => {
        let prefix = conf.prefixes.support
        let uri = `${lib_api.baseUri}/${prefix}/xpub/${xpub}/delete`
        return lib_api.sendGetUriEncoded(uri, {})
    },

    /**
     * Gets the status of a xpub rescan
     */
    getXpubRescanStatus: (xpub) => {
        let uri = `${lib_api.baseUri}/xpub/${xpub}/import/status`
        return lib_api.sendGetUriEncoded(uri, {})
    },

    /**
     * Notifies the server of the new HD account for tracking.
     */
    postXpub: (args) => {
        let uri = `${lib_api.baseUri}/xpub`
        return lib_api.sendPostUriEncoded(uri, args)
    },

    /**
     * Wallet
     */
    getWallet: (args) => {
        let uri = `${lib_api.baseUri}/wallet`
        return lib_api.sendGetUriEncoded(uri, args)
    },

    /**
     * Transaction
     */
    getTransaction: (txid) => {
        let uri = `${lib_api.baseUri}/tx/${txid}`
        return lib_api.sendGetUriEncoded(
            uri,
            {
                'fees': 1
            }
        )
    },

    /**
     * Raw transaction
     */
    getRawTransaction: (txid) => {
        const uri =   `${lib_api.baseUri}/tx/${txid}/hex`
        return lib_api.sendGetUriEncoded(uri)
    },

    /**
     * Transactions
     */
    getTransactions: (args) => {
        let uri = `${lib_api.baseUri}/txs`
        return lib_api.sendGetUriEncoded(uri, args)
    },

    /**
     * Rescans a range of blocks
     */
    getBlocksRescan: (fromHeight, toHeight) => {
        let prefix = conf.prefixes.support
        let uri = `${lib_api.baseUri}/tracker/${prefix}/rescan`
        return lib_api.sendGetUriEncoded(
            uri,
            {
                'fromHeight': fromHeight,
                'toHeight': toHeight
            }
        )
    },

    /**
     * HTTP requests methods
     */
    sendGetUriEncoded: async (uri, data = {}) => {
        const accessToken = lib_auth.getAccessToken()

        const searchParams = new URLSearchParams(data).toString()

        const response = await fetch(`${uri}?${searchParams}`, { method: 'GET', headers: { Authorization: `Bearer ${accessToken}` } })

        return response.ok ? Promise.resolve(await response.json()) : Promise.reject(await response.json())
    },

    sendPostUriEncoded: async (uri, data) => {
        const accessToken = lib_auth.getAccessToken()

        const bodyData = new URLSearchParams(data).toString()

        const response = await fetch(uri, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                Authorization: `Bearer ${accessToken}`
            },
            body: bodyData
        })

        return response.ok ? Promise.resolve(await response.json()) : Promise.reject(await response.json())
    },

    sendGetJson: async (uri) => {
        const accessToken = lib_auth.getAccessToken()

        const response = await fetch(uri, { method: 'GET', headers: { Authorization: `Bearer ${accessToken}` } })

        return response.ok ? Promise.resolve(await response.json()) : Promise.reject(await response.json())
    },


    sendPostJson: async (uri, data) => {
        const accessToken = lib_auth.getAccessToken()

        const response = await fetch(uri, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${accessToken}`
            },
            body: JSON.stringify(data)
        })

        return response.ok ? Promise.resolve(await response.json()) : Promise.reject(await response.json())
    },

    sendPatchJson: async (uri, data) => {
        const accessToken = lib_auth.getAccessToken()

        const response = await fetch(uri, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${accessToken}`
            },
            body: JSON.stringify(data)
        })

        return response.ok ? Promise.resolve(await response.json()) : Promise.reject(await response.json())
    },

    sendDelete: async (uri) => {
        const accessToken = lib_auth.getAccessToken()

        const response = await fetch(uri, { method: 'DELETE', headers: { Authorization: `Bearer ${accessToken}` } })

        return response.ok ? Promise.resolve(await response.json()) : Promise.reject(await response.json())
    }

}
