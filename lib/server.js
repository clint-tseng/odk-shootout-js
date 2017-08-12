const exit = require('express-graceful-exit');
const service = require('express')();
const bodyParser = require('body-parser');
const { ok, notfound, badrequest, bail } = require('./util');
const { connect } = require('./data');
const { submissionsToSimpleCsvStream, submissionsToZipStream } = require('./xml');



//////////////////
// DATABASE SETUP

// initialize our top-level static database instance.
const db = connect();

// initialize our model objects.
const Blob = require('./model/blob')(db);
const Submission = require('./model/submission')(db);



/////////////////
// SERVICE SETUP

// for now, just take in plain-text bodies. easy to augment with other formats.
service.use(bodyParser.text({ type: '*/*' }));

// on SIGTERM, reject further requests, and await completion of inflight requests.
service.use(exit.middleware(service));

// our basic test endpoint that just writes the POST body into the database.
service.post('/blob', (request, response) => {
  const blob = new Blob({ body: request.body });
  blob.save().then((result) => { ok(response, result); }).catch(bail(response));
});

// gets back a specific posted blob.
service.get('/blob/:id', (request, response) => {
  // TODO: this can be genericized.
  Blob.getById(request.params.id).then((result) => {
    if (result == null)
      notfound(response);
    else
      ok(response, result.body);
  }).catch(bail(response));
});

// combined endpoint for POSTing any form submission.
service.post('/submission', (request, response) => {
  const submission = Submission.fromXml(request.body);
  if (submission instanceof Error)
    badrequest(response, submission);
  else
    submission.save().then(ok(response)).catch(bail(response));
});

// helper for shared logic between the streaming outputs. fetches a template
// record if requested and calls the given streaming function with maybe-it.
const _templateAndStream = (streamFunc) => (request, response) => {
  const formId = request.params.formId, instanceId = request.query.templateInstanceId;

  const go = (template) => {
    Submission.queryByFormId(formId).stream((stream) => {
      streamFunc(formId, stream, template).pipe(response);
    });
  }

  if (instanceId != null)
    Submission.getSingle(formId, instanceId).then((template) => {
      if (template == null) notfound(response); else go(template.xml);
    });
  else
    go()
};

// get all submissions for any form in ZIP format containing joinable CSVs.
// accepts optional templateInstanceID qs param indicating the record whose schema to
// follow on export.
service.get('/submission/:formId.csv.zip', _templateAndStream(submissionsToZipStream));

// get all submissions for any form in CSV format.
// accepts optional templateInstanceID qs param indicating the record whose schema to
// follow on export.
service.get('/submission/:formId.csv', _templateAndStream(submissionsToSimpleCsvStream));

// get all submissions for any form.
service.get('/submission/:formId', (request, response) => {
  Submission.listByFormId(request.params.formId).then(ok(response)).catch(bail(response));
});

// get a single submission for a single form.
service.get('/submission/:formId/:instanceId', (request, response) => {
  Submission.getSingle(request.params.formId, request.params.instanceId).then(ok(response)).catch(bail(response));
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

