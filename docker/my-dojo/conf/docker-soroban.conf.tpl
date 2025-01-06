#########################################
# CONFIGURATION OF SOROBAN CONTAINER
#########################################

# Install and run a Soroban node inside Dojo (recommended)
# Value: on | off
SOROBAN_INSTALL=on

# Public Soroban RPC API
# Setting the value to "on" advertizes the onion address of your Soroban node on the network
# Making this address public allows others users to interact with the Soroban network through your Soroban node
# Values: on | off
SOROBAN_ANNOUNCE=off


#
# EXPERT SETTINGS
#

# List of Soroban seed nodes (mainnet)
# Seeds nodes allow your Soroban node to connect to the P2P Soroban network.
# Items of this list must be separated by a comma and each item must be a valid libp2p multiaddr
# Do not modify this list if you're not sure about the potential risks (split network, etc) associated to the modification.
# Type: alphanumeric
SOROBAN_P2P_BOOTSTRAP_MAIN="/onion3/sorisiuznu6pq6bu3mi5wju3tbgqvxukjcwq43zoiywdqspea2bjjtid:8043/p2p/16Uiu2HAmQTYgs7ec8tdXmLBhoVeFcmQTdGCso95cqLGKMt3B4qCL,/onion3/sor6dlytdec7povaomplfylbgmxwfvk3nezejsme57iymqgfpm3eloid:8045/p2p/16Uiu2HAkvsdHAUzhEP7nhrD8oB3BnAKqEyku7RFCbX1whhoBwoNn,/onion3/sorqyjhyngcninys3yqdr6lth22wmdcs6bsu7k2fbgkajcixcmadfayd:8047/p2p/16Uiu2HAm1FiuZhRn23RsSTzkDbM1KXwthWxuKoUyuuEmbGrCpVxf"

# List of Soroban seed nodes (testnet)
# Type: alphanumeric
SOROBAN_P2P_BOOTSTRAP_TEST="/onion3/sorisiuznu6pq6bu3mi5wju3tbgqvxukjcwq43zoiywdqspea2bjjtid:8043/p2p/16Uiu2HAmQTYgs7ec8tdXmLBhoVeFcmQTdGCso95cqLGKMt3B4qCL,/onion3/sor6dlytdec7povaomplfylbgmxwfvk3nezejsme57iymqgfpm3eloid:8045/p2p/16Uiu2HAkvsdHAUzhEP7nhrD8oB3BnAKqEyku7RFCbX1whhoBwoNn,/onion3/sorqyjhyngcninys3yqdr6lth22wmdcs6bsu7k2fbgkajcixcmadfayd:8047/p2p/16Uiu2HAm1FiuZhRn23RsSTzkDbM1KXwthWxuKoUyuuEmbGrCpVxf"
