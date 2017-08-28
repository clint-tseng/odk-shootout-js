const exit = require('express-graceful-exit');
const service = require('express')();
const bodyParser = require('body-parser');
const morgan = require('morgan');

const { ok, notfound, notacceptable, badrequest, notimplemented, bail } = require('./util');
const { connect } = require('./data');
const { submissionsToSimpleCsvStream, submissionsToZipStream, submissionsToJsonStream } = require('./xml');
const { schemaToEdmx } = require('./odata');



////////////////////////////////////////////////////////////////////////////////
// DATABASE SETUP

// initialize our top-level static database instance.
const db = connect();

// initialize our model objects.
const Blob = require('./model/blob')(db);
const Submission = require('./model/submission')(db);
const Form = require('./model/form')(db);



////////////////////////////////////////////////////////////////////////////////
// SERVICE SETUP

// for now, just take in plain-text bodies. easy to augment with other formats.
service.use(bodyParser.text({ type: '*/*' }));

// on SIGTERM, reject further requests, and await completion of inflight requests.
service.use(exit.middleware(service));

// apache request commonlog.
service.use(morgan('common'));



////////////////////////////////////////////////////////////////////////////////
// SUBMISSIONS (nonstandard ODK API)

// combined endpoint for POSTing any form submission.
service.post('/submissions', (request, response) => {
  const submission = Submission.fromXml(request.body);
  if (submission instanceof Error)
    badrequest(response, submission);
  else
    submission.save().then(ok(response)).catch(bail(response));
});



////////////////////////////////////////////////////////////////////////////////
// ODATA

// wrapper/preamble to handle global OData things for all requests.
const jsonRequest = (x) => /^(application\/json|json$)/i.test(x);
const supportedParams = [ '$format', '$count', '$skip', '$top' ];
const odata = (f_, json = true) => (request, response) => {
  if (json === true)
    // ensure the client is requesting JSON and not ATOM/XML (section 7/section 8.2.1).
    if (!(jsonRequest(request.query['$format']) || jsonRequest(request.headers['accept'] )))
      return notacceptable(response);

  // if the client is requesting a lesser OData-MaxVersion reject (section 8.2.7).
  const maxVersion = request.headers['odata-maxversion'];
  if ((maxVersion != null) && (parseFloat(maxVersion) < 4.0))
    return notfound(response);

  // if the client is request functionality we do not support, reject (section 11.2.1/9.3.1).
  for (const key in request.query)
    if (supportedParams.indexOf(key) < 0)
      return notimplemented(response, key);

  // respond with the appropriate OData version (section 8.1.5).
  response.append('OData-Version', '4.0');

  // call the actual endpoint.
  f_(request, response);
};

// serves a service document comprising the primary dataset and any implicit
// subtables created via repeats (section 11.1.1).
service.get('/forms/:formId.svc', odata(async (request, response) => {
  const form = await Form.getByUid(request.params.formId);
  const port = (request.port != null) ? `:${request.port}` : '';
  ok(response, {
    '@odata.context': `${request.protocol}://${request.hostname}${port}${request.path}/$metadata`,
    value: form.tables.map((table) => ({ name: table, kind: 'EntitySet', url: table }))
  }, 'application/json; odata.metadata=minimal');
}));

// serves a metadata document describing the entities in this form
// (section 11.1.2/CSDL). /does not/ require json response, as EDMX is the only
// specification format.
service.get('/forms/:formId.svc/([\$])metadata', odata(async (request, response) => {
  const formId = request.params.formId;
  const form = await Form.getByUid(formId);
  ok(response, schemaToEdmx(formId, form.schema), 'application/xml');
}, false));

// serves a service document comprising the primary dataset and any implicit
// subtables created via repeats (section 11.1.1).
service.get('/forms/:formId.svc/:subtable', odata(async (request, response) => {
  const formId = request.params.formId;
  const subtable = request.params.subtable;
  const form = await Form.getByUid(formId);
  Submission.queryByFormId(formId).stream((stream) => {
    const contextUri = `${request.protocol}://${request.hostname}/forms/${formId}.svc/$metadata#${subtable}`;
    submissionsToJsonStream(form, contextUri, stream).pipe(response);
  });
}));



////////////////////////////////////////////////////////////////////////////////
// FORMS (via REST)

// saves a new form definition.
service.post('/forms', (request, response) => {
  const form = Form.fromXml(request.body);
  if (form instanceof Error)
    badrequest(response, form);
  else
    form.save().then(ok(response)).catch(bail(response));
});

// returns a form definition.
service.get('/forms/:formId', async (request, response) => {
  const form = await Form.getByUid(request.params.formId);
  if (form == null)
    notfound(response);
  else
    ok(response, form);
});



////////////////////////////////////////////////////////////////////////////////
// SUBMISSIONS (via REST, subresource of forms)

// get all submissions for any form.
service.get('/forms/:formId/submissions', (request, response) => {
  Submission.listByFormId(request.params.formId)
    .then(ok(response)).catch(bail(response));
});

// get a single submission for a single form.
service.get('/forms/:formId/submissions/:instanceId', (request, response) => {
  Submission.getSingle(request.params.formId, request.params.instanceId)
    .then(ok(response)).catch(bail(response));
});

// get all submissions for any form in CSV format.
service.get('/forms/:formId/submissions.csv', async (request, response) => {
  const formId = request.params.formId;
  const template = await Form.getByUid(formId);
  if (template == null) return notfound(response);

  Submission.queryByFormId(formId).stream((stream) => {
    response.append('Content-Disposition', `attachment; filename="${formId}.csv"`);
    submissionsToSimpleCsvStream(formId, stream, template).pipe(response);
  });
});

// get all submissions for any form in ZIP format containing joinable CSVs.
service.get('/forms/:formId/submissions.csv.zip', async (request, response) => {
  const formId = request.params.formId;
  const template = await Form.getByUid(formId);
  if (template == null) return notfound(response);

  Submission.queryByFormId(formId).stream((stream) => {
    response.append('Content-Disposition', `attachment; filename="${formId}.csv.zip"`);
    submissionsToZipStream(formId, stream, template).pipe(response);
  });
});


// test endpoint for graceful exit.
service.get('/slow', (_, response) => setTimeout((() => ok(response, 'done')), 5000));




////////////////////////////////////////////////////////////////////////////////
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

