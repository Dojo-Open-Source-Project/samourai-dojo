// Mempool 3.3.2 later drops these foreign keys by their pre-MariaDB-12.1
// generated names. Name them explicitly when its migrations create them.
// Keep this adapter scoped to migration SQL; it changes no server settings.
const migration = require("/backend/package/api/database-migration").default;
const executeQuery = migration.$executeQuery;

migration.$executeQuery = function (query, ...args) {
	const table = query.match(
		/^\s*(?:CREATE TABLE IF NOT EXISTS|ALTER TABLE)\s+`?(blocks|hashrates)`?\s/i,
	)?.[1];
	if (table && !/\bCONSTRAINT\s+\S+\s+FOREIGN KEY/i.test(query)) {
		query = query.replace(
			/\bFOREIGN KEY\s*\(`?pool_id`?\)\s*REFERENCES\s+`?pools`?\s*\(`?id`?\)/i,
			`CONSTRAINT \`${table}_ibfk_1\` $&`,
		);
	}
	return executeQuery.call(this, query, ...args);
};
