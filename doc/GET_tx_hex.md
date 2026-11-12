# Get Transaction hex

Request raw transaction in hex format.

```http request
GET /tx/:txid/hex
```

## Parameters

- **txid** - `string` - The transaction ID
- **at** - `string` (optional) - Access Token (json web token). Required if authentication is activated. Alternatively, the access token can be passed through the `Authorization` HTTP header (with the `Bearer` scheme).

### Examples

```http request
GET /tx/433380957d3a4810df6c2dc351214422587bd138997200efe5fcf43db0cd2e34/hex
```

#### Success

Status code 200 with JSON response:

```json
{
	"status": "ok",
	"data": "0100000000010177bb5bd43b19f4bdba33f52db646d2d3542cd6a6cfb9f650cd883b1945b43a3d0000000000ffffffff024a9738000000000016001401192771c266d0af26733aeee60e69e0c56f24ff0000000000000000536a4c50002425fc00020834b66db59bc88cc0a7fce2046e4dde9700543385054cc4151aa3bdebccb26467a39bb1af25a0ac00ce6fab78ea621d1aae040ba5e600004d3b5a02370a6ef411af70ecb2458b43357f02473044022054ee00c33ddd6078cf791d7164c13cf252d1e750b7f349a48a2ced76fc04684f02205a353447ddd8bc7ff4123cedd12a2a2de93bd19ea1fe81633d72ae38037ecf2e0121021ff982901e54e30ddf9cf890a913f7965f273cc92d73769046e271ab692204c500000000"
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
