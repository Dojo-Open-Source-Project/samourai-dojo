let pairingInfo = null

const screenApiKeysScript = {
    abortController: new AbortController(),

    initPage: () => {
        const newApiKeyButton = document.querySelector('#new-api-key-button')
        const newApiKeyForm = document.querySelector('#new-api-key-form')
        const editApiKeyForm = document.querySelector('#edit-api-key-form')
        const apiKeyPairingDialog = document.querySelector('#api-key-pairing-dialog')
        const apiKeyPairingCloseButton = document.querySelector('#api-key-pairing-close')

        newApiKeyButton.addEventListener('click', () => {
            screenApiKeysScript.openNewApiKeyDialog()
        })

        newApiKeyForm.addEventListener('reset', () => {
            screenApiKeysScript.closeNewApiKeyDialog()
        })

        newApiKeyForm.addEventListener('submit', (event) => {
            event.preventDefault()

            screenApiKeysScript.submitNewApiKey(newApiKeyForm)
        })

        editApiKeyForm.addEventListener('reset', () => {
            screenApiKeysScript.closeEditApiKeyDialog()
        })

        editApiKeyForm.addEventListener('submit', (event) => {
            event.preventDefault()

            screenApiKeysScript.submitUpdateApiKey(editApiKeyForm)
        })

        apiKeyPairingCloseButton.addEventListener('click', () => {
            apiKeyPairingDialog.close()
        })
    },

    preparePage: () => {
        screenApiKeysScript.clearApiKeys()
        screenApiKeysScript.displayApiKeys()
    },

    unpreparePage: () => {
        screenApiKeysScript.clearApiKeys()
    },

    openNewApiKeyDialog: () => {
        const YEAR = 1000*60*60*24*365
        const now = new Date()
        const newApiKeyExpiration = document.querySelector('#new-api-key-expiration')

        const expirationDate = new Date(now.getTime() + YEAR)

        newApiKeyExpiration.setAttribute('min', now.toISOString().slice(0, 16))
        newApiKeyExpiration.value = expirationDate.toISOString().slice(0, 16)

        document.querySelector('#new-api-key-dialog').showModal()
    },

    openEditApiKeyDialog: ({ apikey, expiresAt, active, label }) => {
        document.querySelector('#edit-api-key-apikey').value = apikey
        document.querySelector('#edit-api-key-label').value = label
        document.querySelector('#edit-api-key-active').checked = active

        const expiration = document.querySelector('#edit-api-key-expiration')
        expiration.value = new Date(expiresAt).toISOString().slice(0, 16)
        expiration.setAttribute('min', new Date().toISOString().slice(0, 16))

        document.querySelector('#edit-api-key-dialog').showModal()
    },

    closeNewApiKeyDialog: () => {
        document.querySelector('#new-api-key-dialog').close()
    },

    closeEditApiKeyDialog: () => {
        document.querySelector('#edit-api-key-dialog').close()
    },

    submitNewApiKey: (newApiKeyForm) => {
        const formData = new FormData(newApiKeyForm)
        const label = String(formData.get('label'))
        const expiresAt = new Date(String(formData.get('expiresAt')))

        lib_api.createApiKey({ label, expiresAt }).then(() => {
            lib_msg.displayMessage('API key created successfully')
            screenApiKeysScript.clearApiKeys()
            screenApiKeysScript.displayApiKeys()
            newApiKeyForm.reset()
            screenApiKeysScript.closeNewApiKeyDialog()
        }).catch((error) => {
            lib_errors.processError(error)
        })
    },

    submitUpdateApiKey: (editApiKeyForm) => {
        const formData = new FormData(editApiKeyForm)
        const apikey = String(formData.get('apikey'))
        const label = String(formData.get('label'))
        const expiresAt = new Date(String(formData.get('expiresAt')))
        const active = formData.get('active') === 'on'

        lib_api.updateApiKey(apikey, { label, expiresAt, active }).then(() => {
            lib_msg.displayMessage('API key created successfully')
            screenApiKeysScript.clearApiKeys()
            screenApiKeysScript.displayApiKeys()
            editApiKeyForm.reset()
            screenApiKeysScript.closeEditApiKeyDialog()
        }).catch((error) => {
            lib_errors.processError(error)
        })
    },

    /**
     * Delete an API key
     * @param {string} apikey
     */
    deleteApiKey: (apikey) => {
        const confirmDelete = window.confirm('Are you sure you want to delete this API key?')

        if (confirmDelete) {
            lib_api.deleteApiKey(apikey).then(() => {
                lib_msg.displayMessage('API key deleted successfully')
                screenApiKeysScript.clearApiKeys()
                screenApiKeysScript.displayApiKeys()
            }).catch((error) => {
                lib_errors.processError(error)
            })
        }
    },

    /**
     * Open the API key pairing dialog
     * @param {string} apikey
     * @param {string} label
     */
    openApiKeyPairingDialog: (apikey, label) => {
        const apiKeyPairingDialog = document.querySelector('#api-key-pairing-dialog')

        const pairingInfoPromise = pairingInfo ? Promise.resolve(pairingInfo) : lib_api.getPairingInfo()

        pairingInfoPromise
            .then((apiInfo) => {
                pairingInfo = apiInfo
                const result = apiInfo

                result.pairing.url = `${window.location.protocol}//${window.location.host}${conf.api.baseUri}`
                result.pairing.apikey = apikey

                document.querySelector('#api-key-pairing-payload').value = JSON.stringify(result, null, 4)
                document.querySelector('#api-key-pairing-heading').textContent = label

                const pairingQrcode = new QRCode({ content: JSON.stringify(result), join: true, height: 256, width: 256 }).svg()
                document.querySelector('#api-key-qr-pairing').innerHTML = pairingQrcode
                apiKeyPairingDialog.showModal()
            }).catch((error) => {
                lib_errors.processError(error)
            })
    },

    clearApiKeys: () => {
        screenApiKeysScript.abortController.abort()
        document.querySelector('#api-key-container').innerHTML = ''
    },

    displayApiKeys: () => {
        screenApiKeysScript.abortController = new AbortController()

        lib_api.getApiKeys().then(
            (result) => {
                if (result.length > 0) {
                    const apiKeyContainer = document.querySelector('#api-key-container')

                    const table = apiKeyContainer.appendChild(document.createElement('table'))
                    table.classList.add('table')

                    const thead = table.appendChild(document.createElement('thead'))
                    const tbody = table.appendChild(document.createElement('tbody'))

                    const trHead = thead.appendChild(document.createElement('tr'))
                    trHead.appendChild(document.createElement('th')).textContent = 'Label'
                    trHead.appendChild(document.createElement('th')).textContent = 'Created'
                    trHead.appendChild(document.createElement('th')).textContent = 'Expires'
                    trHead.appendChild(document.createElement('th')).textContent = 'Active'
                    trHead.appendChild(document.createElement('th'))

                    for (const apiKey of result) {
                        const createdAt = new Date(apiKey.createdAt)
                        const expiresAt = new Date(apiKey.expiresAt)


                        const tr = tbody.appendChild(document.createElement('tr'))
                        const pairingLink = tr.appendChild(document.createElement('td')).appendChild(document.createElement('a'))

                        pairingLink.textContent = apiKey.label
                        pairingLink.setAttribute('href', '#')
                        pairingLink.addEventListener('click', (event) => {
                            event.preventDefault()

                            screenApiKeysScript.openApiKeyPairingDialog(apiKey.apikey, apiKey.label)
                        }, { signal: screenApiKeysScript.abortController.signal})

                        tr.appendChild(document.createElement('td')).textContent = createdAt.toUTCString()
                        const expiresCell = tr.appendChild(document.createElement('td'))
                        expiresCell.textContent = expiresAt.toUTCString()
                        if (expiresAt.getTime() < Date.now()) {
                            expiresCell.classList.add('text-danger')
                        }

                        const activeCell = tr.appendChild(document.createElement('td')).appendChild(document.createElement('strong'))
                        activeCell.textContent = apiKey.active ? 'Yes' : 'No'
                        activeCell.classList.add(apiKey.active ? 'text-success' : 'text-danger')

                        const btnGroup = tr.appendChild(document.createElement('td')).appendChild(document.createElement('div'))
                        btnGroup.classList.add('btn-group')

                        const editButton = btnGroup.appendChild(document.createElement('button'))
                        const deleteButton = btnGroup.appendChild(document.createElement('button'))

                        editButton.textContent = 'Edit'
                        editButton.classList.add('btn', 'btn-success', 'btn-sm')
                        editButton.addEventListener('click', () => {
                            screenApiKeysScript.openEditApiKeyDialog(apiKey)
                        }, {signal: screenApiKeysScript.abortController.signal})

                        deleteButton.textContent = 'Delete'
                        deleteButton.classList.add('btn', 'btn-danger', 'btn-sm')
                        deleteButton.addEventListener('click', () => {
                            screenApiKeysScript.deleteApiKey(apiKey.apikey)
                        }, {signal: screenApiKeysScript.abortController.signal})
                    }
                } else {
                    const apiKeyContainer = document.querySelector('#api-key-container')
                    const noApiKey = apiKeyContainer.appendChild(document.createElement('div'))
                    noApiKey.textContent = 'No API keys found'
                }
            }
        ).catch((error) => {
            lib_errors.processError(error)
        })
    }

}

screenScripts.set('#screen-api-keys', screenApiKeysScript)
