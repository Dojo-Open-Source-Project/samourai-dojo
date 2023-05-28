const statusScript = {

    initPage: () => {
        statusScript.chaintipBitcoind = 0
        statusScript.chaintipIndexer = 0
        statusScript.chaintipDb = 0
        // Refresh API status
        setInterval(() => {
            statusScript.refreshApiStatus()
        }, 60000)
        // Refresh PushTx status
        setInterval(() => {
            statusScript.refreshPushTxStatus()
        }, 60000)
    },

    preparePage: () => {
        statusScript.refreshApiStatus()
        statusScript.refreshPushTxStatus()
    },

    refreshApiStatus: () => {
        // Set default values displayed
        statusScript.setStatusIndicator('#db-status-ind', 'idle')
        statusScript.setStatusIndicator('#tracker-status-ind', 'idle')
        statusScript.setStatusIndicator('#indexer-status-ind', 'idle')
        document.querySelector('#tracker-uptime').textContent = '-'
        document.querySelector('#tracker-chaintip').textContent = '-'
        document.querySelector('#db-chaintip').textContent = '-'
        document.querySelector('#indexer-chaintip').textContent = '-'
        document.querySelector('#indexer-type').textContent = '-'
        document.querySelector('#indexer-url').textContent = '-'

        //lib_msg.displayMessage('Loading API status info...');
        return lib_api.getApiStatus().then(apiStatus => {
            if (apiStatus) {
                document.querySelector('#tracker-uptime').textContent = apiStatus.uptime

                const {blocks, indexer} = apiStatus
                if (blocks) {
                    statusScript.chaintipBitcoind = blocks
                    statusScript.chaintipDb = blocks
                    document.querySelector('#db-chaintip').textContent = blocks
                    document.querySelector('#tracker-chaintip').textContent = blocks
                    statusScript.setStatusIndicator('#db-status-ind', 'ok')
                    statusScript.setStatusIndicator('#tracker-status-ind', 'ok')
                } else {
                    statusScript.setStatusIndicator('#db-status-ind', 'ko')
                    statusScript.setStatusIndicator('#tracker-status-ind', 'ko')
                }

                if (indexer) {
                    const indexerMaxHeight = indexer.maxHeight
                    if (indexerMaxHeight) {
                        statusScript.chaintipIndexer = indexerMaxHeight
                        document.querySelector('#indexer-chaintip').textContent = indexerMaxHeight
                        statusScript.setStatusIndicator('#indexer-status-ind', 'ok')
                    } else {
                        statusScript.setStatusIndicator('#indexer-status-ind', 'ko')
                    }
                    const indexerType = indexer.type
                    if (indexerType) {
                        sessionStorage.setItem('indexerType', indexerType)
                        document.querySelector('#indexer-type').textContent = indexerType.replaceAll('_', ' ')
                    }
                    const indexerUrl = indexer.url
                    if (indexerUrl)
                        document.querySelector('#indexer-url').textContent = indexerUrl
                }

                statusScript.checkChaintips()
                //lib_msg.cleanMessagesUi()
            }
        }).catch(error => {
            statusScript.setStatusIndicator('#db-status-ind', 'ko')
            statusScript.setStatusIndicator('#tracker-status-ind', 'ko')
            statusScript.setStatusIndicator('#indexer-status-ind', 'ko')
            lib_errors.processError(error)
        })
    },

    refreshPushTxStatus: () => {
        // Set default values displayed
        statusScript.setStatusIndicator('#node-status-ind', 'idle')
        document.querySelector('#node-uptime').textContent = '-'
        document.querySelector('#node-chaintip').textContent = '-'
        document.querySelector('#node-version').textContent = '-'
        document.querySelector('#node-network').textContent = '-'
        document.querySelector('#node-conn').textContent = '-'
        document.querySelector('#node-relay-fee').textContent = '-'

        //lib_msg.displayMessage('Loading Tracker status info...');
        lib_api.getPushtxStatus().then(pushTxStatus => {
            if (pushTxStatus) {
                const {data} = pushTxStatus
                statusScript.setStatusIndicator('#node-status-ind', 'ok')
                const uptime = lib_cmn.timePeriod(data.uptime)
                document.querySelector('#node-uptime').textContent = uptime
                statusScript.chaintipBitcoind = data.bitcoind.blocks
                document.querySelector('#node-chaintip').textContent = data.bitcoind.blocks
                document.querySelector('#node-version').textContent = data.bitcoind.version
                const network = data.bitcoind.testnet === true ? 'testnet' : 'mainnet'
                document.querySelector('#node-network').textContent = network
                document.querySelector('#node-conn').textContent = data.bitcoind.conn
                document.querySelector('#node-relay-fee').textContent = data.bitcoind.relayfee
                statusScript.checkChaintips()
                //lib_msg.cleanMessagesUi()
            }
        }).catch(error => {
            statusScript.setStatusIndicator('#node-status-ind', 'ko')
            lib_errors.processError(error)
        })
    },

    checkChaintips: () => {
        if (statusScript.chaintipBitcoind > statusScript.chaintipDb) {
            statusScript.setStatusIndicator('#db-status-ind', 'desynchronized')
            statusScript.setStatusIndicator('#tracker-status-ind', 'desynchronized')
        }
        if (statusScript.chaintipBitcoind > statusScript.chaintipIndexer) {
            statusScript.setStatusIndicator('#indexer-status-ind', 'desynchronized')
        } else if (statusScript.chaintipBitcoind < statusScript.chaintipIndexer) {
            statusScript.setStatusIndicator('#node-status-ind', 'desynchronized')
            statusScript.setStatusIndicator('#db-status-ind', 'desynchronized')
            statusScript.setStatusIndicator('#tracker-status-ind', 'desynchronized')
        }
    },

    setStatusIndicator: (id, status) => {
        switch (status) {
        case 'ok': {
            document.querySelector(id).innerHTML = '&#10003;'
            document.querySelector(id).style.color = '#76d776'

            break
        }
        case 'ko': {
            document.querySelector(id).innerHTML = 'X'
            document.querySelector(id).style.color = '#f77c7c'

            break
        }
        case 'desynchronized': {
            document.querySelector(id).innerHTML = '&#10003;'
            document.querySelector(id).style.color = '#f0c649'

            break
        }
        default: {
            document.querySelector(id).innerHTML = '-'
            document.querySelector(id).style.color = '#efefef'
        }
        }
    },

}

screenScripts.set('#screen-status', statusScript)
