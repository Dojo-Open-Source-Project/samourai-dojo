const pushtxScript = {

    processedSchedTxs: new Set(),

    initPage: () => {
        // Refresh PushTx status
        setInterval(() => {
            pushtxScript.refreshPushTxStatus()
        }, 60000)
        // Refresh ScheduledTxs list
        setInterval(() => {
            pushtxScript.refreshScheduledTxsList()
        }, 60000)
    },

    preparePage: () => {
        pushtxScript.refreshPushTxStatus()
        pushtxScript.refreshScheduledTxsList()
    },

    refreshPushTxStatus: () => {
        //lib_msg.displayMessage('Loading PushTx status info...');
        lib_api.getPushtxStatus().then(pushTxStatus => {
            if (pushTxStatus) {
                const {data} = pushTxStatus
                const uptime = lib_cmn.timePeriod(data.uptime)
                document.querySelector('#pushed-uptime').textContent = uptime
                document.querySelector('#pushed-count').textContent = data.push.count
                document.querySelector('#pushed-amount').textContent = data.push.amount
                //lib_msg.cleanMessagesUi()
            }
        }).catch(error => {
            document.querySelector('#pushed-uptime').textContent = '-'
            document.querySelector('#pushed-count').textContent = '-'
            document.querySelector('#pushed-amount').textContent = '-'
            lib_errors.processError(error)
        })
    },

    refreshScheduledTxsList: () => {
        //lib_msg.displayMessage('Loading PushTx orchestrator status info...');
        lib_api.getOrchestratorStatus().then(orchestrStatus => {
            if (orchestrStatus) {
                const {data} = orchestrStatus
                for (let tx of data.txs) {
                    if (!pushtxScript.processedSchedTxs.has(tx.schTxid)) {
                        pushtxScript.displayScheduledTx(tx)
                        pushtxScript.processedSchedTxs.add(tx.schTxid)
                    }
                }
                document.querySelector('#scheduled-count').textContent = data.txs.length
                //lib_msg.cleanMessagesUi()
            }
        }).catch(error => {
            lib_errors.processError(error)
        })
    },

    displayScheduledTx: (tx) => {
        const newRow = `<tr><td colspan="2">&nbsp;</td></tr>
      <tr class="table-value">
        <td class="table-label">TXID</td>
        <td class="table-value" id="scheduled-txid">${tx.schTxid}</td>
      </tr>
      <tr class="table-value">
        <td class="table-label">Schedule Id</td>
        <td class="table-value" id="scheduled-txid">${tx.schID}</td>
      </tr>
      <tr class="table-value">
        <td class="table-label">Scheduled for block</td>
        <td class="table-value" id="scheduled-trigger">${tx.schTrigger}</td>
      </tr>
      <tr class="table-value">
        <td class="table-label">Created on</td>
        <td class="table-value" id="scheduled-created">${lib_fmt.unixTsToLocaleString(tx.schCreated)}</td>
      </tr>
      <tr class="table-value">
        <td class="table-label">Parent TXID</td>
        <td class="table-value" id="scheduled-parent-txid">${tx.schParentTxid}</td>
      </tr>
      <tr class="table-value">
        <td class="table-label">Raw Transaction</td>
        <td class="table-value" id="scheduled-tx">
          <pre class="raw-tx">${tx.schRaw}</pre>
        </td>
      </tr>`

        document.querySelector('#table-scheduled-txs tr:last-child').insertAdjacentHTML('afterend', newRow)
    },

}

screenScripts.set('#screen-pushtx', pushtxScript)
