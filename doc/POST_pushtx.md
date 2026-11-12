# PushTX

Push a transaction to the network.

```http request
POST /pushtx/
```
Parameters must be passed in the body of the request as url encoded arguments.

## Parameters

- **tx** - `hex string` - The raw transaction hex
- **at** - `string` (optional) - Access Token (json web token). Required if authentication is activated. Alternatively, the access token can be passed through the `Authorization` HTTP header (with the `Bearer` scheme).
- **strict_mode_vouts** (optional) - `string` - A pipe-separated list of outpoints indices. A strict verification is enforced on these outpoints before the transaction is pushed. Strict mode checks that addresses associated to these outputs aren't reused. If verifications fail, push is aborted and an error is returned.

### Example

```http request
POST /pushtx/

tx=abcdef0123456789
strict_mode_vouts=0|2|3
```

#### Success

Status code 200 with JSON response:

```json
{
	"status": "ok",
	"data": "<txid>"
}
```

#### Failure

Status code 400 with JSON response:

```json
{
	"status": "error",
	"error": "<error message>"
}
```

or status code 200 with JSON response:

```json
{
  "status": "error",
  "error": {
    "message": [<vout>],
    "code": "VIOLATION_STRICT_MODE_VOUTS"
  }
}
```
