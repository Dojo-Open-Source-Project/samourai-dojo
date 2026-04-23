##################################
# CONFIGURATION OF NGINX CONTAINER
##################################

# Expose nginx (Dojo API) to network
# Warning: Do this only if you understand the risks
# See NGINX_EXTERNAL_IP
# Value: on | off
NGINX_EXTERNAL=off

# IP address used to expose nginx (Dojo API) to network
# This parameter is inactive if NGINX_EXTERNAL isn't set to 'on'
# Recommended value:
#   linux: 127.0.0.1
#   macos or windows: IP address of the VM running the docker host
# Type: string
NGINX_EXTERNAL_IP=127.0.0.1

# Port used to expose nginx (Dojo API) to network
# This parameter is inactive if NGINX_EXTERNAL isn't set to 'on'
# Type: number
NGINX_EXTERNAL_PORT=3000
