#########################################
# CONFIGURATION OF NODE JS CONTAINER
#########################################

# API key required for accessing the services provided by the server
# Keep this API key secret!
# Provide a value with a high entropy!
# Type: alphanumeric
NODE_API_KEY=myApiKey

# API key required for accessing the admin/maintenance services provided by the server
# Keep this Admin key secret!
# Provide a value with a high entropy!
# Type: alphanumeric
NODE_ADMIN_KEY=myAdminKey

# BIP47 Payment Code used for admin authentication
# Type: alphanumeric
NODE_PAYMENT_CODE=

# Secret used by the server for signing Json Web Token
# Keep this value secret!
# Provide a value with a high entropy!
# Type: alphanumeric
NODE_JWT_SECRET=myJwtSecret

# Indexer or third-party service used for imports and rescans of addresses
# Values: local_bitcoind | local_indexer | third_party_explorer
NODE_ACTIVE_INDEXER=local_bitcoind

# FEE TYPE USED FOR FEES ESTIMATIONS BY BITCOIND
# Allowed values are ECONOMICAL or CONSERVATIVE
NODE_FEE_TYPE=ECONOMICAL

# Push transaction through PandoTx (Soroban network)
# Has effect only if SOROBAN_INSTALL=on
# Value: on | off
NODE_PANDOTX_PUSH=off

# Process transaction received through PandoTx (Soroban network)
# Has effect only if SOROBAN_INSTALL=on and SOROBAN_ANNOUNCE=on
# Value: on | off
NODE_PANDOTX_PROCESS=on

# Max number of retries in case of a failed push
# Type: numeric
NODE_PANDOTX_NB_RETRIES=2


