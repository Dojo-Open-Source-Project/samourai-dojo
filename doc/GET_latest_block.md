# Get Latest block information

Request information about latest mined block.

```http request
GET /latest-block
```

## Parameters
* **at** - `string` (optional) - Access Token (json web token). Required if authentication is activated. Alternatively, the access token can be passed through the `Authorization` HTTP header (with the `Bearer` scheme).

### Examples

```http request
GET /latest-block
```

#### Success
Status code 200 with JSON response:
```json
{
  "height": 820468,
  "hash": "00000000000000000001558a524524bc9f54c77ae7f219a0342f43a079722e62",
  "time": 1742224936
}
```
