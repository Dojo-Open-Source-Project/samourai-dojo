/*!
 * test/lib/bitcoin/addresses-helper.js
 * Copyright © 2019 – Katana Cryptographic Ltd. All Rights Reserved.
 */


import assert from 'assert'
// eslint-disable-next-line import/no-unresolved
import {bitcoinMessageFactory} from '@samouraiwallet/bitcoinjs-message'
import * as ecc from 'tiny-secp256k1'

import network from '../../../lib/bitcoin/network.js'
import addrHelper from '../../../lib/bitcoin/addresses-helper.js'

const btcMessage = bitcoinMessageFactory(ecc)

const activeNet = network.network


/**
 * Test vectors
 */

// ZPUB
// zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs'

const VECTOR_1 = [
    [
        '0330d54fd0dd420a6e5f8d3624f5f3482cae350f79d5f0753bf5beef9c2d91af3c',
        'my6RhGaMEf8v9yyQKqiuUYniJLfyU4gzqe',
        '2N8ShdHvtvhbbrWPBQkgTqvNtP5Bp33veEi',
        'tb1qcr8te4kr609gcawutmrza0j4xv80jy8zmfp6l0'
    ],
    [
        '03e775fd51f0dfb8cd865d9ff1cca2a158cf651fe997fdc9fee9c1d3b5e995ea77',
        'munoNuscNJfEbrQyEQt1CmYDeNtQseT378',
        '2N6erLsHUv6mpaiHS6UVy3EEtNU1mtgF6Bq',
        'tb1qnjg0jd8228aq7egyzacy8cys3knf9xvrn9d67m'
    ],
    [
        '03025324888e429ab8e3dbaf1f7802648b9cd01e9b418485c5fa4c1b9b5700e1a6',
        'mmBsCKnjnyGQbHanuXgRRocN43Tmb1TLJG',
        '2N6HZAqLDHQGHhb1sFRYkdZMFEijiXD7Yvx',
        'tb1q8c6fshw2dlwun7ekn9qwf37cu2rn755ut76fzv'
    ]
]

const VECTOR_2 = [
    ['0330d54fd0dd420a6e5f8d3624f5f3482cae350f79d5f0753bf5beef9c2d91af3c', true],
    ['0239c7029670faa4882bbdf6599127a6e3b39519c3d02bb5825d9db424d647d553', true],
    ['046655feed4d214c261e0a6b554395596f1f1476a77d999560e5a8df9b8a1a3515217e88dd05e938efdd71b2cce322bf01da96cd42087b236e8f5043157a9c068e', false]
]

const VECTOR_3 = [
    ['tb1qcr8te4kr609gcawutmrza0j4xv80jy8zmfp6l0', true],
    ['my6RhGaMEf8v9yyQKqiuUYniJLfyU4gzqe', false],
    ['2N8ShdHvtvhbbrWPBQkgTqvNtP5Bp33veEi', false]
]

const VECTOR_4 = [
    ['tb1qcr8te4kr609gcawutmrza0j4xv80jy8zmfp6l0', 'c0cebcd6c3d3ca8c75dc5ec62ebe55330ef910e2'],
    ['tb1qnjg0jd8228aq7egyzacy8cys3knf9xvrn9d67m', '9c90f934ea51fa0f6504177043e0908da6929983'],
    ['tb1q8c6fshw2dlwun7ekn9qwf37cu2rn755ut76fzv', '3e34985dca6fddc9fb369940e4c7d8e2873f529c']
]

// privkey, pubkey, [[msg, sig, expected result]]
const VECTOR_5 = [
    [
        '9eedbdda033d9e34bc5d197011347a1cd69ca10b4b3db5a08e97176c3650b814',
        '03fc9f2d8cd6e576e50ca3bc76e64186788075def0eef1f5d8c8dda803c4fcd999',
        [
            [
                'this is a message to be signed',
                '207438b235b471b1fdc143924eb2c44e8de7aa870c776402ded6dd414816c6b43c49524df636d8cd3353ce5a15ef18f385fc7a68866f09d6df41a8635c234684f2',
                true
            ],
            [
                'this is a message to be signed',
                '207438b235b471b1fdc143924eb2c44e8de7aa870c776402ded6dd414816c6b43c49524df636d8cd3353ce5a15ef18f385fc7a68866f09d6df41a8635c234684f3',
                false
            ]
        ]
    ]
]

const SCRIPT_PUBKEY_VECTORS = [
    [
        '76a914ad4308d34646441b365fb71089b25b9a8454d91388ac', // P2PKH
        'mwK5VsrRPki1DdGfGtX5srtisxdJwnqrao'
    ],
    [
        'a91422d760255d1fb03d44538c0340f8e7fa59c5fe8587', // P2SH
        '2MvRSyN1sefUKSEb6QGq8ZEuDXcTA2Df2S4'
    ],
    [
        '0014f60834ef165253c571b11ce9fa74e46692fc5ec1', // P2WPKH
        'tb1q7cyrfmck2ffu2ud3rn5l5a8yv6f0chkp9y62q6'
    ],
    [
        '0020b1de16ca69d3946907ac5e5fe19b609eea46c06b7bd366d1ae0a831e547f014c', // P2WSH v0
        'tb1qk80pdjnf6w2xjpavte07rxmqnm4ydsrt00fkd5dwp2p3u4rlq9xq65vqf8'
    ],
    [
        '5120a60869f0dbcf1dc659c9cecbaf8050135ea9e8cdc487053f1dc6880949dc684c', // P2WSH v1 (P2TR)
        'tb1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqp3mvzv'
    ]
]


describe('AddressesHelper', () => {

    describe('p2pkhAddress()', () => {
        it('should successfully derive P2PKH addresses from pubkeys', () => {
            for (const v of VECTOR_1) {
                const pkb = Buffer.from(v[0], 'hex')
                const addr = addrHelper.p2pkhAddress(pkb)
                assert.strictEqual(addr, v[1])
            }
        })
    })

    describe('p2wpkhP2shAddress()', () => {
        it('should successfully derive P2WPKH-P2SH addresses from pubkeys', () => {
            for (const v of VECTOR_1) {
                const pkb = Buffer.from(v[0], 'hex')
                const addr = addrHelper.p2wpkhP2shAddress(pkb)
                assert.strictEqual(addr, v[2])
            }
        })
    })

    describe('p2wpkhAddress()', () => {
        it('should successfully derive bech32 addresses from pubkeys', () => {
            for (const v of VECTOR_1) {
                const pkb = Buffer.from(v[0], 'hex')
                const addr = addrHelper.p2wpkhAddress(pkb)
                assert.strictEqual(addr, v[3])
            }
        })
    })

    describe('isSupportedPubKey()', () => {
        it('should successfully detect a compressed pubkey', () => {
            for (const v of VECTOR_2) {
                assert.strictEqual(addrHelper.isSupportedPubKey(v[0]), v[1])
            }
        })
    })

    describe('isBech32()', () => {
        it('should successfully detect a bech32 address', () => {
            for (const v of VECTOR_3) {
                assert.strictEqual(addrHelper.isBech32(v[0]), v[1])
            }
        })
    })

    describe('getScriptHashFromBech32()', () => {
        it('should successfully extract the script hash from a bech32 address', () => {
            for (const v of VECTOR_4) {
                assert.strictEqual(addrHelper.getScriptHashFromBech32(v[0]), v[1])
            }
        })
    })

    describe('verifySignature()', () => {
        it('should successfully verify signatures', () => {
            const prefix = activeNet.messagePrefix

            for (const tc of VECTOR_5) {
                const privKey = Buffer.from(tc[0], 'hex')
                const pubKey = Buffer.from(tc[1], 'hex')
                const address = addrHelper.p2pkhAddress(pubKey)

                for (const stc of tc[2]) {
                    const msg = stc[0]
                    const targetSig = Buffer.from(stc[1], 'hex')
                    const expectedResult = stc[2]

                    const sig = btcMessage.sign(msg, privKey, true, prefix)

                    // Check that library returns valid result
                    assert.strictEqual((Buffer.from(sig).compare(targetSig) === 0), expectedResult)

                    // Check method
                    const result = addrHelper.verifySignature(msg, address, sig)
                    assert(result)
                }
            }
        })
    })

    describe('isP2pkhScript()', () => {
        const p2pkhScriptPubKey = Buffer.from(SCRIPT_PUBKEY_VECTORS[0][0], 'hex')
        const p2shScriptPubKey = Buffer.from(SCRIPT_PUBKEY_VECTORS[1][0], 'hex')

        it('should successfully detect P2PKH scriptpubkey', () => {
            assert.strictEqual(addrHelper.isP2pkhScript(p2pkhScriptPubKey), true)
        })

        it('should return false for non P2PKH scriptpubkey', () => {
            assert.strictEqual(addrHelper.isP2pkhScript(p2shScriptPubKey), false)
        })
    })

    describe('isP2shScript()', () => {
        const p2shScriptPubKey = Buffer.from(SCRIPT_PUBKEY_VECTORS[1][0], 'hex')
        const p2wpkhScriptPubKey = Buffer.from(SCRIPT_PUBKEY_VECTORS[2][0], 'hex')

        it('should successfully detect P2SKH scriptpubkey', () => {
            assert.strictEqual(addrHelper.isP2shScript(p2shScriptPubKey), true)
        })

        it('should return false for non P2SKH scriptpubkey', () => {
            assert.strictEqual(addrHelper.isP2shScript(p2wpkhScriptPubKey), false)
        })
    })

    describe('isP2wpkhScript()', () => {
        const p2wpkhScriptPubKey = Buffer.from(SCRIPT_PUBKEY_VECTORS[2][0], 'hex')
        const p2pkhScriptPubKey = Buffer.from(SCRIPT_PUBKEY_VECTORS[3][0], 'hex')

        it('should successfully detect P2WPKH scriptpubkey', () => {
            assert.strictEqual(addrHelper.isP2wpkhScript(p2wpkhScriptPubKey), true)
        })

        it('should return false for non P2WPKH scriptpubkey', () => {
            assert.strictEqual(addrHelper.isP2wpkhScript(p2pkhScriptPubKey), false)
        })
    })

    describe('isP2wshScript()', () => {
        const p2wshhScriptPubKey = Buffer.from(SCRIPT_PUBKEY_VECTORS[3][0], 'hex')
        const p2wpkhScriptPubKey = Buffer.from(SCRIPT_PUBKEY_VECTORS[2][0], 'hex')

        it('should successfully detect P2WSH scriptpubkey', () => {
            assert.strictEqual(addrHelper.isP2wshScript(p2wshhScriptPubKey), true)
        })

        it('should return false for non P2WSH scriptpubkey', () => {
            assert.strictEqual(addrHelper.isP2wshScript(p2wpkhScriptPubKey), false)
        })
    })

    describe('isP2trScript()', () => {
        const p2trScriptPubKey = Buffer.from(SCRIPT_PUBKEY_VECTORS[4][0], 'hex')
        const p2wshScriptPubKey = Buffer.from(SCRIPT_PUBKEY_VECTORS[3][0], 'hex')

        it('should successfully detect P2TR scriptpubkey', () => {
            assert.strictEqual(addrHelper.isP2trScript(p2trScriptPubKey), true)
        })

        it('should return false for non P2TR scriptpubkey', () => {
            assert.strictEqual(addrHelper.isP2trScript(p2wshScriptPubKey), false)
        })
    })

    describe('outputScript2Address()', () => {
        it('should return correct address corresponding to scriptpubkey', () => {
            for (const [scriptPubKey, address] of SCRIPT_PUBKEY_VECTORS) {
                const scriptPubKeyBuffer = Buffer.from(scriptPubKey, 'hex')
                const convertedAddress = addrHelper.outputScript2Address(scriptPubKeyBuffer)

                assert.strictEqual(convertedAddress, address)
            }
        })

        it('should return null on invalid sciptpubkey', () => {
            const randomData = Buffer.from('5120a60869f0dbcf1dc659c9cecbaf8050135ea9e8cdc48705', 'hex')

            assert.strictEqual(addrHelper.outputScript2Address(randomData), null)
        })
    })

})
