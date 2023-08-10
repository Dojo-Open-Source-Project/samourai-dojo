# Get Fees

Returns fees estimated by [$1 Fee Estimator](https://code.samourai.io/dojo/one-dollar-fee-estimator-js). Fee rates are in Satoshi/byte.
Fee estimates returned correspond to chances of being included in the next block: `[50%, 90%, 99%, 99.9%]`

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
[
  7,
  12,
  13,
  13
]
```

#### Failure

This API endpoint will respond with HTTP 503 error if fee estimator is not connected or not working.

Status code 503 with JSON response:
```json
{
  "status": "error",
  "error": "<error message>"
}
```
