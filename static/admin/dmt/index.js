/**
 * Global obkjects
 */

// Ordered list of screens
const screens = [
    '#screen-welcome',
    '#screen-status',
    '#screen-pushtx',
    '#screen-pairing',
    '#screen-api-keys',
    '#screen-xpubs-tools',
    '#screen-addresses-tools',
    '#screen-txs-tools',
    '#screen-blocks-rescan',
    '#screen-help-dmt'
]

// Ordered list of menu items
const tabs = [
    '#link-welcome',
    '#link-status',
    '#link-pushtx',
    '#link-pairing',
    '#link-api-keys',
    '#link-xpubs-tools',
    '#link-addresses-tools',
    '#link-txs-tools',
    '#link-blocks-rescan',
    '#link-help-dmt'
]

// Mapping of scripts associaed to screens
const screenScripts = new Map()


/**
 * UI initialization
 */
function initTabs() {
    // Activates the current tab
    let currentTab = sessionStorage.getItem('activeTab')
    if (!currentTab)
        currentTab = '#link-status'
    document.querySelector(currentTab).classList.add('active')

    // Sets event handlers
    for (let tab of tabs) {
        document.querySelector(tab).addEventListener('click', () => {
            document.querySelector(sessionStorage.getItem('activeTab')).classList.remove('active')
            sessionStorage.setItem('activeTab', tab)
            document.querySelector(tab).classList.add('active')
            preparePage()
        })
    }
}

function initPages() {
    // Dynamic loading of screens and scripts
    lib_cmn.includeHTML(_initPages)
    // Dojo version
    let lblVersion = sessionStorage.getItem('lblVersion')
    if (lblVersion == null) {
        lib_api.getPairingInfo().then(apiInfo => {
            lblVersion = `v${apiInfo.pairing.version}`
            sessionStorage.setItem('lblVersion', lblVersion)
            document.querySelector('#dojo-version').textContent = lblVersion
        })
    } else {
        document.querySelector('#dojo-version').textContent = lblVersion
    }
}

function _initPages() {
    for (let screen of screens) {
        const screenScript = screenScripts.get(screen)
        if (screenScript)
            screenScript.initPage()
    }
    preparePage()
    document.querySelector('#top-container').removeAttribute('hidden')
}

function preparePage() {
    lib_msg.cleanMessagesUi()
    const activeTab = sessionStorage.getItem('activeTab')
    for (let idxTab in tabs) {
        const screen = screens[idxTab]
        if (tabs[idxTab] === activeTab) {
            document.querySelector(screen).removeAttribute('hidden')
            if (screenScripts.has(screen)) {
                screenScripts.get(screen).preparePage()
            }
        } else {
            document.querySelector(screen).setAttribute('hidden', '')
            if (screenScripts.has(screen)) {
                const pageScripts = screenScripts.get(screen)
                pageScripts.unpreparePage && pageScripts.unpreparePage()
            }
        }
    }
}

(() => {
    // Refresh the access token
    lib_auth.refreshAccessToken()
    setInterval(() => {
        lib_auth.refreshAccessToken()
    }, 300000)

    // Inits menu and pages
    initTabs()
    initPages()

    // Set event handlers
    document.querySelector('#btn-logout').addEventListener('click', () => {
        lib_auth.logout()
    })
})()
