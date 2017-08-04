build
-----

Prerequisites: nodejs >= 8.0, postgresql.

Set up `config/default.json` or override it as explained [here](https://github.com/lorenwest/node-config).

Then just run `make` to build and run migrations. `make run` runs the server (essentially just `node lib/server.js`). `make run-multi` spawns a four-process server capable of higher load. It is managed by [Naught](https://github.com/andrewrk/naught). `make stop-multi` stops it.

