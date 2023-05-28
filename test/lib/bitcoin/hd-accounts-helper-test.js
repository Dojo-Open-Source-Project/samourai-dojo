/*!
 * test/lib/bitcoin/hd-accounts-helper.js
 * Copyright © 2019 – Katana Cryptographic Ltd. All Rights Reserved.
 */


import assert from 'assert'
import hdaHelper from '../../../lib/bitcoin/hd-accounts-helper.js'
import errors from '../../../lib/errors.js'


/**
 * Test vectors
 */

const XPUB = 'tpubDDDAe7GgFT4fzEzKwWVA4BWo8fiJXQeGEYDTexzo2w6CK1iDoLPYkpEisXo623ieF79GQ3xpcEVN1vcQhX2sysyL8o1XqzBmQb9JReTxQ7w'
const YPUB = 'upub5ELkCsSF68UnAZE7zF9CDztvHeBJiAAhwa4VxEFzZ1CfQRbpy93mkBbUZsqYVpoeEHFwY3fGh9bfftH79ZwbhjUEUBAxQj551TMxVyny4UX'
const ZPUB = 'vpub5ZB1WY7AEp2G1rREpbvpS5zRTcKkenACrgaijd9sw1aYTXR4DoDLNFFcb5o8VjTZdvNkHXFq9oxDZAtfsGMcVy9qLWsNzdtZHBRbtXe87LB'

const POSTMIX_ZPUB = 'vpub5Y6cjg7GbwSLRu33XB76n3EoJZscmYSVEToLSMqD6ugAcm4rof8E9yvDiaFfhGEuyL95P9VD4A9W3JrBTZhzWSXiRyYvWFnUBAZc67X32wh'

const XPUB_VECTORS = new Map([
    ['xpub6BosfCnifzxcFwrSzQiqu2DBVTshkCXacvNsWGYJVVhhawA7d4R5WSWGFNbi8Aw6ZRc1brxMyWMzG3DSSSSoekkudhUd9yLb6qx39T9nMdj', [
        'ypub6We8xsTdpgW67F3ZpmWU77JgfS29gpX5Y2u6HfSBsW5ae2yLsiae8WAQGaZJ85b1y4ipMLYvSAiY9Kq1A8rpSzSWW3B3jtA5Na1gXzZ8iqF',
        'zpub6qUQGY8YyN3ZxYEgf8J6KCQBqQAbdSWaT9RK54L5FWTTh8na8NkCkZpYHnWt7zEwNhqd6p9Utq562cSZsqGqFE87NNsUKnyZeJ5KvbhfC8E'
    ]],
    ['xpub6C6nQwHaWbSrzs5tZ1q7m5R9cPK9eYpNMFesiXsYrgc1P8bvLLAet9JfHjYXKjToD8cBRswJXXbbFpXgwsswVPAZzKMa1jUp2kVkGVUaJa7', [
        'ypub6Ww3ibxVfGzLrAH1PNcjyAWenMTbbAosGNB6VvmSEgytSER9azLDWCxoJwW7Ke7icmizBMXrzBx9979FfaHxHcrArf3zbeJJJUZPf663zsP',
        'zpub6qmK2GdQoxXphTU8DjQNBFc9xKc3XnoNBUhKHKfKchMmVLENqeVn8GcwL9ThKYme2Qqnvq8RSrJh2PkpPGhy5rXmizkRBZ7naCd33hHSpaN'
    ]],
    ['xpub6CatWdiZiodmUeTDp8LT5or8nmbKNcuyvz7WyksVFkKB4RHwCD3XyuvPEbvqAQY3rAPshWcMLoP2fMFMKHPJ4ZeZXYVUhLv1VMrjPC7PW6V', [
        'ypub6XR9pJPUsVBFKweLeV85HtwdxjjmKEuUr6djm9mNdkh47X7ASsD6byaXFotRAKByFoWgSzCuoTjaYdrv2yoJroLAPtBuHFjVm5vNmhyNehE',
        'zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs'
    ]]
])

const TPUB_VECTORS = new Map([
    ['tpubDCBWBScQPGv4Xk3JSbhw6wYYpayMjb2eAYyArpbSqQTbLDpphHGAetB6VQgVeftLML8vDSUEWcC2xDi3qJJ3YCDChJDvqVzpgoYSuT52MhJ', [
        'upub5DK5kCmyDxLAi4H6VLMyGkvfyZSMvLZ5sapDA5reMUa4RdiRs5vPeFXrBkix8SyLLWFbMSAgbXJLcBNkHMCmG3i72gPMQEt8Hfm6ydxa9N4',
        'vpub5Y9M3sStNdseZMUDKh9bUr2B9XaorxYanhLRwUkXjUwwUjXf7k5xGKBzCxgY8MdFk9NQ6umF4BetVTzK13cn4HPhu25mz9hcZPpkNEQ4Gjp'
    ]],
    ['tpubDCUQwB7GDsQKGfGk1CpCxzkWwWQodwKRttFB55vhCbMu8RGdQZ1k2ayVXmdJrER313963TTB4dRdx12JLjjBNpcs3v6shG93ci6A2XiGuJN', [
        'upub5DbzVwGq4YpRSyWY3wUF8p8e6Usopgqsbv6DNMBtifUNDqAEaMfy1xLFE7fmL1W2zDFmBT9d9YXwbxgznndu6g7mPJGJG12MDaJp6j9WNDJ',
        'vpub5YSFobwkDEMuJGhetJFsLuE9GT2FmJqNX2cS9k5n6frFGvyTq1qXe1zPFKdMKv9xPrNZvvkBcCtVVFJZWV3utuoNFdxiquqqVJNTVNFiiVA'
    ]],
    ['tpubDCxX2sYFS5bDkSe5GKKYHjBW7tgyN1R3UchpLJvdbf54ohxeGRtd8MbDUe1cguVHe4vnK68DsuD5MXjxi9EXx16rb9EnNsaF5KT99CinaJz', [
        'upub5E66bdhpGm1KvkssK3yaTYZdGs9yYkwVBeYrdaBq7jBXu7rFSEYr7iwyAz45AgaHdF3TT5pfxpKP1VQfAC9FfrbkvXQCwcTYgBfoDTNH1hz',
        'vpub5YvMuJNjRSYon44z9QmCfdf8SqJRVNvz6m55Qy5iVjZQxDfUgtiQjnc7CC1fAbED2tAGCZRERUfvtn2DstZGU6HMns6dXXH2wujSc2wfi2x'
    ]]
])

const BIP44_VECTORS = [
    [0, 0, 'mmZ5FRccGAkwfKme4JkrsmurnimDLdfmNL'],
    [0, 1, 'n3yomLicyrSULiNWFKHsK8erntSpJZEPV6'],
    [0, 2, 'mvVYLwjmMuYVWbuTyB9UE6LWah9tevLrrE'],
    [0, 3, 'n1CrG3NpdTiFWh8KgsnAGUgn6aEF8xvYY2'],
    [0, 4, 'mw3JvPz3wdUVrmTD6WugHgahk97QWnD61L'],

    [1, 0, 'miYMfmg3F3QpBJ48oVzvSi4NVgi93ykJ1L'],
    [1, 1, 'mvEnHm9ZFcdnBa5wNfiJ6yVViex8wReDJJ'],
    [1, 2, 'muSWDErhMRUHb6nSQqnVLp3TctqsKjKY4G'],
    [1, 3, 'mhxsuiLirgVeRT9Nb9iUVrmCTgNDc1tcNa'],
    [1, 4, 'mtj8CDwFPa4cfyK9cgfSCaXvDxdszgFFVU']
]

const BIP49_VECTORS = [
    [0, 0, '2NCmqrb5eXMYZUxdnY4Dr8h3FKqH6JmWCco'],
    [0, 1, '2NCxTGKxDsv9gyC2wjBev85WHP1GN8LCKfR'],
    [0, 2, '2N7vmdwgKjVxkivSou6F8Zaj37SxH7jASaC'],
    [0, 3, '2NBeYshMWNj5jiMBuk9mfywY2853QKgDJ9k'],
    [0, 4, '2MutR6UcnThCUmFJVUrT2z265pNGQcj6DV3'],

    [1, 0, '2MvSusqGmAB5MNz66dVLndV8AVKBvhidCdS'],
    [1, 1, '2MxCqx15GTdW8wDXAVSsxnmHTjoqQLEEzQt'],
    [1, 2, '2N7megh7h2CiCcGWcXax266BtjxZy5Hovrf'],
    [1, 3, '2N8CrDFMsFA7Gs9phdA7xpm3RrDgvk719ro'],
    [1, 4, '2Msi1iNCJcxsxX5ENiVzzqWw8GuCJG8zfmV']
]

const BIP84_VECTORS = [
    [0, 0, 'tb1qggmkgcrk5zdwm8wlh2nzqv5k7xunv3tqk6w9p0'],
    [0, 1, 'tb1q7enwpjlzuc3taq69mkpyqmkwn8d5mtrvmvzl9m'],
    [0, 2, 'tb1q53zh56awxvk824msyxhfjtlwg4fwd3s2s5wygh'],
    [0, 3, 'tb1q6l6lm298eq5qkwntl42lv2x0vw6yny50ugnuef'],
    [0, 4, 'tb1q4fre2as0az62am5eaj30tupv92crqd8yjpu67w'],

    [1, 0, 'tb1qyykyu2y9lx6qt2y6j3nur88ssnpuapnug9zuv4'],
    [1, 1, 'tb1q59awztrl7dfn7l38a8uvgrkstrw4lf4fwmz2kt'],
    [1, 2, 'tb1qnza9973gp8f7rm9k9yc327zwdvz9wl9sa3yvp7'],
    [1, 3, 'tb1qrttk0uzx656uupg9w8f39ec6e6c8wwcts4fanj'],
    [1, 4, 'tb1qjrnw8u2pvspm6hq3aa83ff93wevq2zyxqczewy']
]

const POSTMIX_VECTORS = [
    [1, 0, 'tb1qv3laps2vues6nh9fkxpds3wxd0cttd9jnr0772'],
    [1, 1, 'tb1qz538rwwchv2unf97g4pugv3wjwxxjaypnwz8sk'],
    [1, 2, 'tb1qdm3hfvw3knzujxx24g05e30kpe7vk0ez3dk0h8'],
    [1, 3, 'tb1qxn4jgg5hgl3eggvt4alvraladpwq9pj30fy5ze'],
    [1, 4, 'tb1qw2ghyxhqv5ysyehq9p9xwux4zqaf0mcwm29agh'],

    [1, 0, 'mpgLz1YXDU9buy7Zn8w9w9mJtrGghiXotH'],
    [1, 1, 'mhShkJxHHgzJd2WcqeaKL4spqBMe1wcaK5'],
    [1, 2, 'mqdH74foDiN8hV2mmFSHnceCm7vgErd4A2'],
    [1, 3, 'mkLm7vUy1rij3YicskkQJxGovnGDG6G2oj'],
    [1, 4, 'mqxjZfjdSdUmecTVALzhoQBPFRNvLViMBr'],

    [1, 0, '2N5UxwLfWexxHDm5MKHoyitRLWEK8x25tiA'],
    [1, 1, '2N8wnnGoJujWGrM5YLs1nC1TFuszx2vJVA9'],
    [1, 2, '2NA6Ja6PM6YMuQpSQdeWofKRV9pcBbz4aii'],
    [1, 3, '2NFLd63BqGzh5BtfxobuU4dpoThg9sxMPth'],
    [1, 4, '2NEeziC2dc3nbf9k3fyUWBzLWbn4MTrR2mm']

]

const HD_TYPES_VECTORS = [
    // unlocked
    [0, hdaHelper.BIP44, false],
    [1, hdaHelper.BIP49, false],
    [2, hdaHelper.BIP84, false],
    // locked
    [128, hdaHelper.BIP44, true],
    [129, hdaHelper.BIP49, true],
    [130, hdaHelper.BIP84, true],
]


describe('HdAccountsHelper', () => {

    describe('isXpub()', () => {
        it('should successfully detect a XPUB', () => {
            assert(hdaHelper.isXpub(XPUB))
            assert(!hdaHelper.isXpub(YPUB))
            assert(!hdaHelper.isXpub(ZPUB))
        })

        it('should successfully detect a YPUB', () => {
            assert(!hdaHelper.isYpub(XPUB))
            assert(hdaHelper.isYpub(YPUB))
            assert(!hdaHelper.isYpub(ZPUB))
        })

        it('should successfully detect a ZPUB', () => {
            assert(!hdaHelper.isZpub(XPUB))
            assert(!hdaHelper.isZpub(YPUB))
            assert(hdaHelper.isZpub(ZPUB))
        })
    })


    describe('isValid()', () => {
        it('should successfully validate a valid XPUB', () => {
            assert(hdaHelper.isValid(XPUB))
        })

        it('should successfully validate a valid YPUB', () => {
            assert(hdaHelper.isValid(YPUB))
        })

        it('should successfully validate a valid ZPUB', () => {
            assert(hdaHelper.isValid(ZPUB))
        })
    })


    describe('classify()', () => {
        it('should successfully classify the code stored in db', () => {
            for (const v of HD_TYPES_VECTORS) {
                const ret = hdaHelper.classify(v[0])
                assert.strictEqual(ret.type, v[1])
                assert.strictEqual(ret.locked, v[2])
            }
        })
    })


    describe('makeType()', () => {
        it('should successfully compute the code stored in db', () => {
            for (const v of HD_TYPES_VECTORS) {
                const ret = hdaHelper.makeType(v[1], v[2])
                assert.strictEqual(ret, v[0])
            }
        })
    })


    describe('deriveAddresses()', () => {
        it('should successfully derive addresses with BIP44', async () => {
            for (const v of BIP44_VECTORS) {
                const addresses = await hdaHelper.deriveAddresses(XPUB, v[0], [v[1]], hdaHelper.BIP44)
                assert.strictEqual(addresses[0].address, v[2])
            }
        })

        it('should successfully derive addresses with BIP49', async () => {
            for (const v of BIP49_VECTORS) {
                const addresses = await hdaHelper.deriveAddresses(XPUB, v[0], [v[1]], hdaHelper.BIP49)
                assert.strictEqual(addresses[0].address, v[2])
            }
        })

        it('should successfully derive addresses with BIP84', async () => {
            for (const v of BIP84_VECTORS) {
                const addresses = await hdaHelper.deriveAddresses(XPUB, v[0], [v[1]], hdaHelper.BIP84)
                assert.strictEqual(addresses[0].address, v[2])
            }
        })

        it('should successfully derive additional change address types for postmix account', async () => {
            const addresses = await hdaHelper.deriveAddresses(POSTMIX_ZPUB, 1, [0, 1, 2, 3, 4], hdaHelper.BIP84)

            for (const vector of POSTMIX_VECTORS) {
                assert(addresses.find((addr) => addr.index === vector[1]))
                assert(addresses.find((addr) => addr.address === vector[2]))
            }
        })
    })


    describe('xlatXPUB()', () => {
        it('should translate X/Y/ZPUB to XPUB', () => {
            for (const [xpub, pubs] of XPUB_VECTORS.entries()) {
                for (const pub of pubs) {
                    const translated = hdaHelper.xlatXPUB(pub)

                    assert.strictEqual(translated, xpub)
                }

                const translated = hdaHelper.xlatXPUB(xpub)

                assert.strictEqual(translated, xpub)
            }
        })

        it('should translate T/U/VPUB to TPUB', () => {
            for (const [tpub, pubs] of TPUB_VECTORS.entries()) {
                for (const pub of pubs) {
                    const translated = hdaHelper.xlatXPUB(pub)

                    assert.strictEqual(translated, tpub)
                }

                const translated = hdaHelper.xlatXPUB(tpub)

                assert.strictEqual(translated, tpub)
            }
        })

        it('should throw an error on invalid XPUB', () => {
            assert.throws(() => {
                hdaHelper.xlatXPUB('apub6BosfCnifzxcFwrSzQiqu2DBVTshkCXacvNsWGYJVVhhawA7d4R5WSWGFNbi8Aw6ZRc1brxMyWMzG3DSSSSoekkudhUd9yLb6qx39T9nMdj')
            }, errors.xpub.INVALID)
        })
    })

})
