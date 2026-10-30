#########################################
# CONFIGURATION OF EXPLORER CONTAINER
#########################################


# Install and run a block explorer inside Dojo (recommended)
# Value: on | off
EXPLORER_INSTALL=on

# Enable or disable slow device mode, use for BTC-RPC Explorer
# Value: on | off
EXPLORER_SLOW_DEVICE_MODE=on

# Which explorer to use
# Value: btc_rpc_explorer | mempool_space
EXPLORER_TYPE=btc_rpc_explorer

# Mempool Space uses a separate database and user on Dojo's MariaDB server.
# The database and user names must differ from Dojo's.

# User account used for db access
# Warning: This option must not be modified after the first installation
# Type: alphanumeric
MEMPOOL_MYSQL_USER=mempool

# Password of of user account
# Warning: This option must not be modified after the first installation
# Type: alphanumeric
MEMPOOL_MYSQL_PASS=mempool

# Database name
# Warning: This option must not be modified after the first installation
# Type: alphanumeric
MEMPOOL_MYSQL_DATABASE=mempool
