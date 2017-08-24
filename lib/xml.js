const { merge, get, sanitize, incr, arrayify } = require('./util');

const { Readable, Transform } = require('stream');
const { xml2js } = require('xml-js');
const jpath = require('jsonpath');
const csv = require('csv-stringify');
const archiver = require('archiver');
const uuid = require('uuid/v4');
const jsonStream = require('JSONStream');



////////////////////////////////////////////////////////////////////////////////
// FLAT PRIMITIVE CSV STREAM

// takes a stream of submission database rows and returns a csv filestream.
// strips nested information entirely.
const submissionsToSimpleCsvStream = (_, inStream, template) => {
  const outStream = csv();

  // get our schema and write out headers. ignore nested fields entirely.
  const fields = template.fields.filter(([ _, nested ]) => !nested).map(([ x ]) => x);
  outStream.write(fields);

  // then walk our schema and send data out as appropriate.
  inStream.pipe(new Transform({
    objectMode: true,
    transform(row, _, done) {
      const csvRow = [];
      const json = xml2js(row.xml, { compact: true });
      for (const name of fields) {
        const subquery = name.split('.').map((x) => `['${x}']`).join('');
        const queryResult = jpath.query(json, '$.submission.data.*' + subquery)[0];
        csvRow.push((queryResult == null) ? '' : queryResult._text);
      }
      this.push(csvRow);
      done();
    }
  })).pipe(outStream);

  return outStream;
};



////////////////////////////////////////////////////////////////////////////////
// MULTI-CSV ZIP STREAM

// takes a stream of submission database rows and returns a zip filestream
// containing joinable csv files.
const _streamTable = (inStream, zipStream, path, fields, prefix) => {
  // set up our outputs.
  const outStream = csv();
  zipStream.append(outStream, { name: `${path.join('-')}.csv` });

  // id-generator.
  const genId = incr();

  // determine our effective schema, and immediately write header.
  // we have to ignore nested columns for header output.
  const outFields = (prefix.length === 1) ? fields : prefix.concat(fields); // don't write instance twice on root.
  outStream.write(outFields.filter(([ _, schema ]) => !Array.isArray(schema)).map(([ name ]) => name));
  const rowIdField = prefix[prefix.length - 1][0];

  inStream.pipe(new Transform({
    objectMode: true,
    transform(row, _, done) {
      // generate a uuid for this record and attach it to the row.
      if (rowIdField != '_instanceId') row[rowIdField] = { _text: genId().toString() };

      // walk our schema, send our immediate flat row, and recurse as needed.
      const out = [];
      for (const [ name, subfields ] of outFields) {
        if (subfields == null) {
          // atomic value; send it out.
          const value = get(row, name.split('.'));
          out.push((value == null) ? '' : value._text);
        } else {
          // nested data. create tablestreamer if necessary, and push.
          if (subfields.inStream == null) {
            subfields.inStream = new Readable({ read() {}, objectMode: true });
            const subprefix = prefix.concat([ [ sanitize(`_${name}Id`) ] ]);
            _streamTable(subfields.inStream, zipStream, path.concat([ name ]), subfields, subprefix);
            outStream.on('end', () => subfields.inStream.push(null));
          }

          // normalize output (xml transform does weird things), and inject context
          // information into the row.
          let value = get(row, name.split('.'));
          if (value != null) {
            if (!Array.isArray(value)) value = [ value ];
            for (const subrow of value) {
              for (const subIdField of prefix) subrow[subIdField] = row[subIdField];
              subfields.inStream.push(subrow);
            }
          }
        }
      }
      this.push(out);
      done();
    }
  })).pipe(outStream);

  return outStream;
};
const submissionsToZipStream = (formId, inStream, template) => {
  const zipStream = archiver('zip', { zlib: { level: 9 } });
  const path = [ formId ];

  // here we create a stream transformation that maps our top-level input to look like
  // just data records, so that the recursive function can take over.
  const proxyStream = new Transform({
    objectMode: true,
    transform(row, _, done) {
      // pull out the instanceId and make it explicitly available, to take variability
      // out of the exact tag name. TODO: maybe we should just normalize the tag name instead.
      const json = xml2js(row.xml, { compact: true });
      const [ data ] = jpath.query(json, '$.submission.data.*');
      data._instanceId = { _text: jpath.query(json, '$.submission.data.*._attributes.instanceID')[0] };
      this.push(data);
      done();
    }
  });

  // now we can actually call the recursive function given everything we've created.
  const outStream = _streamTable(proxyStream, zipStream, path, template.fields, [ [ '_instanceId' ] ]);
  outStream.on('end', () => zipStream.finalize());

  // kick everything off with piping and return our final stream.
  inStream.pipe(proxyStream);
  return zipStream;
};



////////////////////////////////////////////////////////////////////////////////
// ODATA JSON STREAM

const _buildJsonRecurse = (data, schema) => {
  let result = {};
  for (const def of schema) {
    const key = def.key;
    const value = data[key];

    if (def.type == 'structure') {
      if (value != null)
        result[key] = _buildJsonRecurse(value, def.children);
    } else if (def.type === 'repeat') {
      if (value != null)
        result[key] = arrayify(value).map((subvalue) => _buildJsonRecurse(subvalue, def.children));
    } else if (def.type === 'int') {
      result[key] = parseInt(value._text);
    } else if (def.type === 'decimal') {
      result[key] = parseFloat(value._text);
    } else if (def.type === 'geopoint') {
      if (value._text != null) {
        const [ _, lat, lng, alt ] = /^([^ ]+) ([^ ]+) [^ ]+ ([^ ]+)$/.exec(value._text);
        result[key] = { type: 'Point', coordinates: [ lng, lat, alt ].map(parseFloat) };
      }
    } else {
      result[key] = value._text;
    }
  }
  return result;
};

const submissionsToJsonStream = (form, path, inStream) => {
  const outStream = jsonStream.stringify(`{"@odata.context":"${path}","value":[\n`, ',\n', ']}');
  const schema = form.schema;

  // this transformation takes database rows and translates them to odata json.
  const transformStream = new Transform({
    objectMode: true,
    transform(row, _, done) {
      const json = xml2js(row.xml, { compact: true });
      const [ data ] = jpath.query(json, '$.submission.data.*');
      this.push(_buildJsonRecurse(data, schema));
      done();
    }
  });

  // now string it all together and push it out.
  return inStream.pipe(transformStream).pipe(outStream);
};



module.exports = { submissionsToSimpleCsvStream, submissionsToZipStream, submissionsToJsonStream };

