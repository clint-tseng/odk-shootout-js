const { merge } = require('./util');

const { xml2js } = require('xml-js');
const jpath = require('jsonpath');
const csv = require('csv-stringify');

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
    {
      // this is some nested single-instance structure. extract and flatten.
      for (const subfield of _processFields(value))
        result.push([ `${key}.${subfield[0]}`, subfield[1] ]);
    }
  }

  return result;
};
// gets the canonical schema for the given xml blob.
const extractFields = (xml) => {
  const json = xml2js(xml, { compact: true });
  return _processFields(jpath.query(json, '$.submission.data.*')[0]);
};

// takes a stream of submission database rows and returns a csv filestream.
const submissionsToCsvStream = (rowStream, template = null) => {
  const out = csv();
  var fields;

  rowStream.on('data', (row) => {
    if (fields == null) {
      // if we are the first row, get our schema and send out headers.
      fields = extractFields(template || row.xml); // PERF: double conv (const cost).
      out.write(fields.map((field) => field[0]));
    }

    // then walk our schema and send data out as appropriate.
    const csvRow = [];
    const json = xml2js(row.xml, { compact: true });
    for (const [ name, def ] of fields) {
      const subquery = name.split('.').map((x) => `['${x}']`).join('');
      if (def == null)
        csvRow.push(jpath.query(json, '$.submission.data.*' + subquery)[0]._text);
      //else
        // handle nested.
    }
    out.write(csvRow);
  });

  rowStream.on('end', () => out.end());
  return out;
}

module.exports = { extractFields, submissionsToCsvStream };

// const fields = jpath.query(json, '$.elements.*.elements[?(@.name == "data")].elements[0].elements.*');
//
