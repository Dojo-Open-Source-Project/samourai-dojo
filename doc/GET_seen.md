# Get Seen addresses

Request if addresses in question have been seen (used) in the past on the blockchain or in current mempool.

```http request
GET /seen?addresses=address1|address2
```

## Parameters
* **addresses** - `string` - list of addresses separated by `|`
* **at** - `string` (optional) - Access Token (json web token). Required if authentication is activated. Alternatively, the access token can be passed through the `Authorization` HTTP header (with the `Bearer` scheme).

### Examples

```http request
GET /seen?addresses=tb1q6v5tpkkpqu5r6gwvpa9xh3atnpyvw2cs9talpp|2NAGTNJJ2XyaZUmGLmgvjWsrDjCpNAFzMT2|tb1qxxsmzzjkswy8jhj6ftqafwhtgu4fna4yvv60j6|mjTEXNB8PdA9qiCSNuh6CukuH3go4ZhVRP|tb1qg9qk94w6247hf6x3vnehe36j2tn9g9e95d9gga
```

#### Success
Status code 200 with JSON response:
```json
{
  "tb1qg9qk94w6247hf6x3vnehe36j2tn9g9e95d9gga": false,
  "mjTEXNB8PdA9qiCSNuh6CukuH3go4ZhVRP": false,
  "tb1qxxsmzzjkswy8jhj6ftqafwhtgu4fna4yvv60j6": false,
  "tb1q6v5tpkkpqu5r6gwvpa9xh3atnpyvw2cs9talpp": true,
  "2NAGTNJJ2XyaZUmGLmgvjWsrDjCpNAFzMT2": true
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
