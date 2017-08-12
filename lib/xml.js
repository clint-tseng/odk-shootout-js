const { merge, get } = require('./util');

const { Readable, Transform } = require('stream');
const { xml2js } = require('xml-js');
const jpath = require('jsonpath');
const csv = require('csv-stringify');
const archiver = require('archiver');
const uuid = require('uuid/v4');

// other than testing, not to be called except from extractFields:
const _processFields = (instance) => {
  var result = [];
  for (const key in instance) {
    if (key === '_attributes') continue;

    const value = instance[key];
    if (Array.isArray(value))
      // multiple instances of this tag exist; merge and detect shared schema.
      result.push([ key, _processFields(merge.apply(null, value)) ]);
    else if (value.hasOwnProperty('_text'))
      // this is an atomic value.
      result.push([ key ]);
    else
      // this is some nested single-instance structure. extract and flatten.
      for (const subfield of _processFields(value))
        result.push([ `${key}.${subfield[0]}`, subfield[1] ]);
  }

  return result;
};
// gets the canonical schema for the given xml blob.
const extractFields = (xml) => {
  const json = xml2js(xml, { compact: true });
  return _processFields(jpath.query(json, '$.submission.data.*')[0]);
};

// takes a stream of submission database rows and returns a csv filestream.
// strips nested information entirely.
const submissionsToSimpleCsvStream = (_, inStream, template = null) => {
  const outStream = csv();
  var fields;

  inStream.on('data', (row) => {
    if (fields == null) {
      // if we are the first row, get our schema and send out headers.
      // PERF: double conv (const cost).
      fields = extractFields(template || row.xml).filter(([ _, nested ]) => !nested).map(([ x ]) => x);
      outStream.write(fields);
    }

    // then walk our schema and send data out as appropriate.
    const csvRow = [];
    const json = xml2js(row.xml, { compact: true });
    for (const name of fields) {
      const subquery = name.split('.').map((x) => `['${x}']`).join('');
      csvRow.push(jpath.query(json, '$.submission.data.*' + subquery)[0]._text);
    }
    outStream.write(csvRow);
  });

  inStream.on('end', () => outStream.end());
  return outStream;
};


// takes a stream of submission database rows and returns a zip filestream
// containing joinable csv files.
const _streamTable = (inStream, zipStream, path, fields, prefix) => {
  // set up our outputs.
  const outStream = csv();
  zipStream.append(outStream, { name: `${path.join('-')}.csv` });

  // determine our effective schema, and immediately write header.
  // we have to ignore nested columns for header output.
  const outFields = (prefix.length === 1) ? fields : prefix.concat(fields); // don't write instance twice on root.
  outStream.write(outFields.filter(([ _, schema ]) => !Array.isArray(schema)).map(([ name ]) => name));
  const rowIdField = prefix[prefix.length - 1][0];

  inStream.pipe(new Transform({
    objectMode: true,
    transform(row, _, done) {
      // generate a uuid for this record and attach it to the row.
      if (rowIdField != '_instanceId') row[rowIdField] = { _text: 'uuid:' + uuid() };

      // walk our schema, send our immediate flat row, and recurse as needed.
      const out = [];
      for (const [ name, subfields ] of outFields) {
        if (subfields == null) {
          // atomic value; send it out.
          out.push(get(row, name.split('.'))._text);
        } else {
          // nested data. create tablestreamer if necessary, and push.
          if (subfields.inStream == null) {
            subfields.inStream = new Readable({ read() {}, objectMode: true });
            const subprefix = prefix.concat([ [ `_${name}Id` ] ]);
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
const submissionsToZipStream = (formId, inStream, template = null) => {
  const zipStream = archiver('zip', { zlib: { level: 9 } });
  const path = [ formId ];

  // we need to do two things: normalize our input to only table contents, and
  // possibly derive a schema. we use a stream transformation to do this.
  let fields = null;
  const proxyStream = new Transform({
    objectMode: true,
    transform(row, _, done) {
      if (fields == null) {
        // our very first row, we won't have fields yet. derive a schema and set
        // up a root level stream.
        fields = extractFields(template || row.xml); // PERF: double conv (const cost);
        const outStream = _streamTable(proxyStream, zipStream, [ formId ], fields, [ [ '_instanceId' ] ]);
        outStream.on('end', () => zipStream.finalize());
      }

      // pull out the instanceId and make it explicitly available, to take variability
      // out of the exact tag name. TODO: maybe we should just normalize the tag name instead.
      const json = xml2js(row.xml, { compact: true });
      const [ data ] = jpath.query(json, '$.submission.data.*');
      data._instanceId = { _text: jpath.query(json, '$.submission.data.*._attributes.instanceID')[0] };
      this.push(data);
      done();
    }
  });

  inStream.pipe(proxyStream);
  return zipStream;
};

module.exports = { extractFields, submissionsToSimpleCsvStream, submissionsToZipStream };

