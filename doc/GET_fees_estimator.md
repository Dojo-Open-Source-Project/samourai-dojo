# Get Fees

Returns fees estimated by [$1 Fee Estimator](https://code.samourai.io/dojo/one-dollar-fee-estimator-js). Fee rates are in satoshi/vByte.
Fee estimates returned correspond to chances of being included in the next block: `10%, 20%, 50%, 90%, 99%, 99.9%`

```http request
GET /fees/estimator
```

## Parameters
* **at** - `string` (optional) - Access Token (json web token). Required if authentication is activated. Alternatively, the access token can be passed through the `Authorization` HTTP header (with the `Bearer` scheme).


### Examples

```http request
GET /fees/estimator
```

#### Success
Status code 200 with JSON response:
```json
{
  "0.1": 7,
  "0.2": 8,
  "0.5": 15,
  "0.9": 20,
  "0.99": 22,
  "0.999": 25
}
```

#### Failure

This API endpoint will respond with HTTP 503 error if fee estimator is not connected, not working or bitcoind mempool is not fully loaded.

Status code 503 with JSON response:
```json
{
  "status": "error",
  "error": "<error message>"
}
```
