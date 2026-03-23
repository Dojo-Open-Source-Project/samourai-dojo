#########################################
# CONFIGURATION OF A LOCAL INDEXER
#########################################

# Install and run a local indexer inside Docker
# Set this option to 'off' for using an indexer hosted outside of Docker
# Value: on | off
INDEXER_INSTALL=off

# Choice which Indexer you would like to install:
# electrs - basic Electrum server for your Dojo - takes 8-12 hrs to index
# fulcrum - fast Electrum server for personal use - takes a 2-3 days to index
# Value: electrs | fulcrum
INDEXER_TYPE=electrs

# IP address of the local indexer used by Dojo
# Set value to 172.28.1.6 if INDEXER_INSTALL is set to 'on'
# Type: string
INDEXER_IP=172.28.1.6

# Port of the RPC API
# Set value to 50001 if INDEXER_INSTALL is set to 'on'
# Type: integer
INDEXER_RPC_PORT=50001

# Support of batch requests by the local indexer
# Set value to active if INDEXER_TYPE is set to 'fulcrum' or you're using external electrum server with RPC batching support
# Value: active | inactive
INDEXER_BATCH_SUPPORT=active

# Choose between TCP and TLS transport when using external electrum server
# Value: tcp | tls
INDEXER_PROTOCOL=tcp

# Expose the electrum API to external apps
# Warning: Do not expose your electrum API to internet!
# See INDEXER_EXTERNAL_IP
# Value: on | off
INDEXER_EXTERNAL=off

# IP address used to expose the electrum API to external apps
# This parameter is inactive if INDEXER_EXTERNAL isn't set to 'on'
# Warning: Do not expose your RPC API to internet!
# Recommended value:
#   linux: 127.0.0.1
#   macos or windows: IP address of the VM running the docker host
# Type: string
INDEXER_EXTERNAL_IP=127.0.0.1


#
# EXPERT SETTINGS
# (ACTIVE IF INDEXER_INSTALL IS SET TO ON)
#

# Number of blocks to get in one JSONRPC request from bitcoind
# Type: integer
INDEXER_BATCH_SIZE=10

# Number of transactions to lookup before returning an error
# Type: integer
INDEXER_TXID_LIMIT=501
