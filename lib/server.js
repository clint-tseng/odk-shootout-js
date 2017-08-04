const exit = require('express-graceful-exit');
const service = require('express')();
const bodyParser = require('body-parser');
const { ok, notfound, bail } = require('./util');
const { connect } = require('./data');



//////////////////
// DATABASE SETUP

// initialize our top-level static database instance.
const db = connect();

// initialize our model objects.
const Blob = require('./model/blob')(db);



/////////////////
// SERVICE SETUP

// for now, just take in plain-text bodies. easy to augment with other formats.
service.use(bodyParser.text({ type: '*/*' }));

// on SIGTERM, reject further requests, and await completion of inflight requests.
service.use(exit.middleware(service));

// our basic test endpoint that just writes the POST body into the database.
service.post('/blob', (request, response) => {
  (new Blob({ body: request.body })).save().catch(bail(response)).then((result) => {
    ok(response, result);
  });
});

// gets back a specific posted blob.
service.get('/blob/:id', (request, response) => {
  // TODO: this can be genericized.
  Blob.getById(request.params.id).catch(bail(response)).then((result) => {
    if (result == null)
      notfound(response);
    else
      ok(response, result.body);
  });
});

// test endpoint for graceful exit.
service.get('/slow', (_, response) => setTimeout((() => ok(response, 'done')), 5000));




/////////////////
// PROCESS SETUP

// gracefully handle process closure via SIGTERM or via naught.
const term = () => {
  exit.gracefulExitHandler(service, server, { log: true, exitProcess: false, callback: () => {
    db.destroy();
    process.exit(0);
  } });
};
process.on('SIGINT', term); // ^C
process.on('SIGTERM', term);
process.on('message', (message) => { // parent process.
  if (message === 'shutdown') term();
});

// start the service.
const server = service.listen(8383, () => {
  // notify parent process we are alive if applicable.
  if (process.send != null) process.send('online');
});

