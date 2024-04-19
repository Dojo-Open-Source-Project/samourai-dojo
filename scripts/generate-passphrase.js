/*!
 * scripts/generate_passphrase.js
 * Copyright © 2019 – Katana Cryptographic Ltd. All Rights Reserved.
 */


import crypto from 'crypto'


/**
 * Script generating a strong random string (256-bits of entropy)
 * Useful for the generation of a strong api key or oa strong jwt secret (see /keys/index-example.js).
 */

function run() {
    const secret = crypto.randomBytes(32).toString('hex')
    console.log(`Generated secret = ${secret}`)
}


/**
 * Launch the script
 */
run()

