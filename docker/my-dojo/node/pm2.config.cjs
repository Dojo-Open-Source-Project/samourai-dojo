const path = require('path')

module.exports = {
    apps: [
        {
            name: 'Samourai Dojo - Accounts',
            namespace: process.env.COMMON_BTC_NETWORK,
            script: './index.js',
            cwd: path.join(process.env.APP_DIR, 'accounts'),
            wait_ready: true,
            stop_exit_codes: 0,
            listen_timeout: 5000,
            kill_timeout: 3000,
        },
        {
            name: 'Samourai Dojo - PushTX',
            namespace: process.env.COMMON_BTC_NETWORK,
            script: './index.js',
            cwd: path.join(process.env.APP_DIR, 'pushtx'),
            wait_ready: true,
            stop_exit_codes: 0,
            listen_timeout: 5000,
            kill_timeout: 3000,
        },
        {
            name: 'Samourai Dojo - PushTX Orhestrator',
            namespace: process.env.COMMON_BTC_NETWORK,
            script: './index-orchestrator.js',
            cwd: path.join(process.env.APP_DIR, 'pushtx'),
            wait_ready: true,
            stop_exit_codes: 0,
            listen_timeout: 5000,
            kill_timeout: 3000,
        },
        {
            name: 'Samourai Dojo - Tracker',
            namespace: process.env.COMMON_BTC_NETWORK,
            script: './index.js',
            cwd: path.join(process.env.APP_DIR, 'tracker'),
            wait_ready: true,
            stop_exit_codes: 0,
            listen_timeout: 5000,
            kill_timeout: 3000,
        },
        {
            name: `Samourai Dojo - Estimator`,
            namespace: process.env.COMMON_BTC_NETWORK,
            script: './index.js',
            cwd: path.join(process.env.APP_DIR, 'estimator'),
            wait_ready: true,
            stop_exit_codes: 0,
            listen_timeout: 5000,
            kill_timeout: 3000,
        }
    ]
}
