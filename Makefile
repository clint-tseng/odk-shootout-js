default: base

node_modules:
	npm install

migrations: node_modules
	node -e ' const { withDatabase, migrate } = require("./lib/data"); withDatabase(migrate);'

base: node_modules migrations

run: base
	node lib/server.js

run-multi: base
	node node_modules/naught/lib/main.js start --worker-count 4 lib/server.js
stop-multi:
	node node_modules/naught/lib/main.js stop

