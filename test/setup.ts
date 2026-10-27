import * as bitcoin from "bitcoinjs-lib";
import network from "../lib/bitcoin/network.js";

// Force testnet before each test file imports modules that capture the network.
network.key = "testnet";
network.network = bitcoin.networks.testnet;
