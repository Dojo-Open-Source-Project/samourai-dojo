const screenTxsToolsScript = {

    explorerInfo: null,
    currentTxid: null,

    initPage: () => {
        screenTxsToolsScript.getExplorerInfo()
        // Sets the event handlers
        document.querySelector('#btn-tx-search-go').addEventListener('click', () => {
            screenTxsToolsScript.searchTx()
        })
        document.querySelector('#btn-txs-details-reset').addEventListener('click', () => {
            screenTxsToolsScript.showSearchForm()
        })
        document.querySelector('#txs-tool').addEventListener('keyup', evt => {
            if (evt.key === 'Enter') {
                screenTxsToolsScript.searchTx()
            }
        })
    },

    preparePage: () => {
        screenTxsToolsScript.showSearchForm()
        document.querySelector('#txid').focus()
    },

    getExplorerInfo: () => {
        lib_api.getPairingInfo().then(pairingInfo => {
            screenTxsToolsScript.explorerInfo = pairingInfo.explorer
        }).catch(error => {
            lib_errors.processError(error)
        })
    },

    searchTx: () => {
        lib_msg.displayMessage('Search in progress...')
        const txid = document.querySelector('#txid').value
        screenTxsToolsScript.currentTxid = txid
        return screenTxsToolsScript._searchTx(txid).then(() => {
            lib_msg.cleanMessagesUi()
        })
    },

    _searchTx: (txid) => lib_api.getTransaction(txid).then((txInfo) => {
        if (txInfo) {
            console.log(txInfo)
            screenTxsToolsScript.setTxDetails(txInfo)
            screenTxsToolsScript.showTxDetails()

            // fetch tx hex
            lib_api.getRawTransaction(txid)
                .then((txHex) => {
                    screenTxsToolsScript.setTxHex(txHex.data)
                })
                .catch((error) => {
                    lib_msg.displayErrors('No transaction hex found')
                    console.log(error)
                })
        }
    }).catch((error) => {
        lib_msg.displayErrors('No transaction found')
        console.log(error)
        throw error
    }),

    setTxDetails: (txInfo) => {
        for (const elem of document.querySelectorAll('tr.input-row')) {
            elem.remove()
        }

        for (const elem of document.querySelectorAll('tr.output-row')) {
            elem.remove()
        }

        const txUrl = lib_cmn.getExplorerTxUrl(screenTxsToolsScript.currentTxid, screenTxsToolsScript.explorerInfo)
        document.querySelector('#txid-value').textContent = screenTxsToolsScript.currentTxid
        document.querySelector('#txid-value').setAttribute('href', txUrl)

        const firstseen = txInfo.created ? lib_fmt.unixTsToLocaleString(txInfo.created) : '--'
        document.querySelector('#tx-firstseen').textContent = firstseen

        if ('block' in txInfo)
            document.querySelector('#tx-location').textContent = ` Block ${txInfo.block.height}`
        else
            document.querySelector('#tx-location').textContent = ' Mempool'


        const nbInputs = txInfo.inputs.length
        document.querySelector('#tx-nb-inputs').textContent = nbInputs

        const nbOutputs = txInfo.outputs.length
        document.querySelector('#tx-nb-outputs').textContent = nbOutputs

        document.querySelector('#tx-vfeerate').textContent = `${txInfo.vfeerate} sats/vbyte`

        const fees = Number.parseInt(txInfo.fees, 10)
        document.querySelector('#tx-fees').textContent = `${fees} sats`

        let amount = fees
        for (let o of txInfo.outputs) {
            amount += Number.parseInt(o.value, 10)
        }
        amount = amount / 100000000
        document.querySelector('#tx-amount').textContent = `${amount} BTC`

        document.querySelector('#tx-size').textContent = `${txInfo.size} bytes`
        document.querySelector('#tx-vsize').textContent = `${txInfo.vsize} vbytes`
        document.querySelector('#tx-version').textContent = txInfo.version

        let nlocktime = Number.parseInt(txInfo.locktime, 10)
        if (nlocktime < 500000000) {
            document.querySelector('#tx-nlocktime').textContent = `Block ${nlocktime}`
        } else {
            nlocktime = lib_fmt.unixTsToLocaleString(nlocktime)
            document.querySelector('#tx-nlocktime').textContent = nlocktime
        }
    },

    setTxHex: (txHex) => {
        if (txHex) {
            const hexWrapperElement = document.querySelector('#txs-tool-hex')

            hexWrapperElement.removeAttribute('hidden')
            document.querySelector('#txs-tool-hex-payload').value = txHex
        }
    },

    showSearchForm: () => {
        document.querySelector('#txs-tool-details').setAttribute('hidden', '')
        document.querySelector('#txid').value = ''
        document.querySelector('#txs-tool-search-form').removeAttribute('hidden')
        document.querySelector('#txs-tool-hex').setAttribute('hidden', '')
        lib_msg.cleanMessagesUi()
    },

    showTxDetails: () => {
        document.querySelector('#txs-tool-search-form').setAttribute('hidden', '')
        document.querySelector('#txs-tool-details').removeAttribute('hidden')
    },

}

screenScripts.set('#screen-txs-tools', screenTxsToolsScript)
