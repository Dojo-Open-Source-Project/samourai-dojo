/*!
 * lib/remote-importer/sources.js
 * Copyright © 2019 – Katana Cryptographic Ltd. All Rights Reserved.
 */

import keysFile from "../../keys/index.js";
import network from "../bitcoin/network.js";
import Logger from "../logger.js";
import BitcoindWrapper from "./bitcoind-wrapper.js";
import LocalIndexerWrapper from "./local-indexer-wrapper.js";
import LocalRestIndexerWrapper from "./local-rest-indexer-wrapper.js";
import OxtWrapper from "./oxt-wrapper.js";
import Sources from "./sources.js";

const keys = keysFile[network.key];

/**
 * Remote data sources for mainnet
 */
class SourcesMainnet extends Sources {
	constructor() {
		super();
		this._initSource();
	}

	/**
	 * Initialize the external data source
	 */
	_initSource() {
		switch (keys.indexer.active) {
			case "local_bitcoind": {
				// If local bitcoind option is activated
				// we'll use the local node as our unique source
				this.source = new BitcoindWrapper();
				Logger.info(
					"Importer : Activated Bitcoind as the data source for imports",
				);

				break;
			}
			case "local_indexer": {
				// If local indexer option is activated
				// we'll use the local indexer as our unique source
				this.source = new LocalIndexerWrapper();
				Logger.info(
					"Importer : Activated local indexer as the data source for imports",
				);

				break;
			}
			case "local_rest_indexer": {
				// If local rest indexer option is activated
				// we'll use the local indexer as our unique source
				const uri = `http://${keys.indexer.localIndexer.host}:${keys.indexer.localIndexer.port}`;
				this.source = new LocalRestIndexerWrapper(uri);
				Logger.info(
					"Importer : Activated local indexer (REST API) as the data source for imports",
				);

				break;
			}
			default: {
				// Otherwise, we'll use the rest api provided by OXT
				this.source = new OxtWrapper(keys.indexer.oxt);
				Logger.info(
					"Importer : Activated OXT API as the data source for imports",
				);
			}
		}
	}
}

export default SourcesMainnet;
