# Get information about public services provided by the Dojo

Get a list of public services provided by the Dojo with pairing information provided for each available service.


```http request
GET /support/services
```

## Parameters
* **at** - `string` (optional) - Access Token (json web token). Required if authentication is activated. Alternatively, the access token can be passed through the `Authorization` HTTP header (with the `Bearer` scheme).


### Examples

```http request
GET /support/services
```

#### Success
Status code 200 with JSON response:
```json
{
  "services": [
    {
      "type": "explorer",
      "kind": "btc_rpc_explorer",
      "url": "http://[...].onion"
    },
    {
      "type": "indexer",
      "kind": "fulcrum",
      "url": "tcp://[...].onion:50001"
    },
    {
      "type": "soroban",
      "kind": "rpc",
      "url": "http://[...].onion/rpc",
      "keyAnnounce": "soroban.cluster.testnet.nodes",
      "keyAuth47": "soroban.auth47.testnet.auth"
    }
  ]
}
```

Each service provided by the Dojo has a corresponding entry in the list.

Each entry in the list is at least composed of:
* a **type** attribute identifying the service,
* a **kind** attribute identifying kind of the service,
* an **url** attribute storing information allowing to access the service.


#### Additional attributes

##### Soroban RPC service
* keyAnnounce: key identifying the Soroban channel used to announce the onion addresses of Soroban public RPC nodes.
* keyAuth47: key identifying the Soroban channel used to publish authentication information to Soroban


#### Failure
Status code 400 with JSON response:
```json
{
  "status": "error",
  "error": "<error message>"
}
```