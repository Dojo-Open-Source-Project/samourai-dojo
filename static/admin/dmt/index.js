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

    // Mobile menu toggle functionality
    const mobileMenuBtn = document.querySelector('#mobile-menu-toggle')
    const mobileMenuOverlay = document.querySelector('#mobile-menu-overlay')
    const menu = document.querySelector('#menu')

    function toggleMobileMenu() {
        mobileMenuBtn.classList.toggle('active')
        mobileMenuOverlay.classList.toggle('active')
        menu.classList.toggle('active')
        
        // Show/hide overlay
        if (mobileMenuOverlay.classList.contains('active')) {
            mobileMenuOverlay.style.display = 'block'
            // Prevent body scroll when menu is open
            document.body.style.overflow = 'hidden'
        } else {
            document.body.style.overflow = ''
            // Delay hiding to allow fade out animation
            setTimeout(() => {
                if (!mobileMenuOverlay.classList.contains('active')) {
                    mobileMenuOverlay.style.display = 'none'
                }
            }, 300)
        }
    }

    function closeMobileMenu() {
        mobileMenuBtn.classList.remove('active')
        mobileMenuOverlay.classList.remove('active')
        menu.classList.remove('active')
        document.body.style.overflow = ''
        setTimeout(() => {
            if (!mobileMenuOverlay.classList.contains('active')) {
                mobileMenuOverlay.style.display = 'none'
            }
        }, 300)
    }

    // Toggle menu when hamburger button is clicked
    mobileMenuBtn.addEventListener('click', toggleMobileMenu)

    // Close menu when overlay is clicked
    mobileMenuOverlay.addEventListener('click', closeMobileMenu)

    // Close menu when a menu item is clicked
    const menuLinks = document.querySelectorAll('#menu .nav-pills a')
    menuLinks.forEach(link => {
        link.addEventListener('click', () => {
            // Only close on mobile (when menu button is visible)
            if (window.getComputedStyle(mobileMenuBtn).display !== 'none') {
                closeMobileMenu()
            }
        })
    })

    // Close menu on window resize if it becomes desktop size
    window.addEventListener('resize', () => {
        if (window.innerWidth > 991 && menu.classList.contains('active')) {
            closeMobileMenu()
        }
    })
})()
