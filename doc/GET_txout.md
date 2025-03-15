# Get txout

Returns unspent transaction output from bitcoin RPC.


```http request
GET /txout/:txid/:index
```

## Parameters
* **at** - `string` (optional) - Access Token (json web token). Required if authentication is activated. Alternatively, the access token can be passed through the `Authorization` HTTP header (with the `Bearer` scheme).
* **txid** - `string` (required) - The transaction id.
* **index** - `number` (required) - The output index.


### Examples

```http request
GET /txout/abcdefgh/1
```

#### Success
Status code 200 with JSON response:
```json
{
  "bestblock": "000000000000000000022fae8c0cc4d474c37e9da070c8c153beb28ea259693a",
  "confirmations": 34,
  "value": 0.00763259,
  "scriptPubKey": {
    "asm": "0 2fc0c1360a689c390d7bfb1fd48a9a6a3f74dc79",
    "desc": "addr(bc1q9lqvzds2dzwrjrtmlv0afz56dglhfhrederpp4)#5pyqnyde",
    "hex": "00142fc0c1360a689c390d7bfb1fd48a9a6a3f74dc79",
    "address": "bc1q9lqvzds2dzwrjrtmlv0afz56dglhfhrederpp4",
    "type": "witness_v0_keyhash"
  },
  "coinbase": false
}
```

#### Failure

Status code 404 with JSON response when transaction output has already been spent:
```json
{
  "status": "error",
  "error": null
}
```

Status code 400 with JSON response:
```json
{
  "status": "error",
  "error": "<error message>"
}
```
