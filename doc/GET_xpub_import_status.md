# Get import status for a HD Account

Check if an import or a rescan is currently processed by Dojo for a given HD Account.

```http request
GET /xpub/:xpub/import/status
```

## Parameters

- **:xpub** - `string` - The extended public key for the HD Account
- **at** - `string` (optional) - Access Token (json web token). Required if authentication is activated. Alternatively, the access token can be passed through the `Authorization` HTTP header (with the `Bearer` scheme).

### Example

```http request
GET /xpub/xpub0123456789/import/status
```

#### Success

Status code 200 with JSON response:

```json
{
	"status": "ok",
	"data": {
		"import_in_progress": false
	}
}
```

```json
{
	"status": "ok",
	"data": {
		"import_in_progress": true,
		"status": "rescan",
		"hits": 1143
	}
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
