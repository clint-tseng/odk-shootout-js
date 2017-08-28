const Base = require('./base');
const { xml2js } = require('xml-js');
const jpath = require('jsonpath');
const { sanitize } = require('../util');


////////////////////////////////////////////////////////////////////////////////
// INTERNAL UTIL

// recursively peels apart an instance structure to derive a schema.
// other than testing, not to be called except from this file.
const _processFields = (instance) => {
  var result = [];
  for (const key in instance) {
    if (key === '_attributes') continue;

    const value = instance[key];
    if ((value._attributes != null) && (value._attributes['jr:template'] != null))
      // multiple instances of this tag exist; merge and detect shared schema.
      result.push([ key, _processFields(value) ]);
    else if ((Object.keys(value).length === 0) || value.hasOwnProperty('_text'))
      // this is an atomic value (source is an empty tag).
      result.push([ key ]);
    else
      // this is some nested single-instance structure. extract and flatten.
      for (const subfield of _processFields(value))
        result.push([ `${key}.${subfield[0]}`, subfield[1] ]);
  }

  return result;
};

// recursive helper to tables getter; walks the nested schema and returns a flat
// array containing the implied 2-dimensional tables.
const _extractTables = (fields, path = []) => {
  let result = [];
  for (const [ field, subfields ] of fields)
    if (subfields != null) {
      result.push(sanitize(field));
      result = result.concat(_extractTables(subfields, path.concat([ sanitize(field) ])));
    }
  return result;
};


// rather than just hierarchical fields, the schema contains all fields along
// with their type information. takes a jsonified xml.
const _processSchemaRecurse = (bindings, instance, path) => {
  let result = [];
  for (const key in instance) {
    if (key === '_attributes') continue;
    const value = instance[key];

    if ((value._attributes != null) && (value._attributes['jr:template'] != null)) {
      // we can detect repeats directly from the instance node. if so, recurse.
      result.push({ key, type: 'repeat', children: _processSchemaRecurse(bindings, value, path.concat([ key ])) });
    } else {
      // locate our binding node.
      const binding = bindings.find((x) => x.nodeset == `/${path.join('/')}/${key}`);

      if (binding == null) {
        // if we have no binding node, this is a structural node with no repeat
        // or data binding.
        result.push({ key, type: 'structure', children: _processSchemaRecurse(bindings, value, path.concat([ key ])) });
      } else {
        // we have an atomic value. determine the type and push it in.
        const type = (binding == null) ? null : binding.type;
        result.push({ key, type });
      }
    }
  }
  return result;
};
const _processSchema = (json) => {
  const model = jpath.query(json, '$.*.*.model')[0];
  const bindings = jpath.query(model, '$.bind.*._attributes');
  const instance = jpath.query(model, '$.instance.*')[0];

  // awkward block to extract the name of the instance root node.
  const rootObj = jpath.query(model, '$.instance')[0];
  let root;
  for (const key in rootObj) root = key;

  // call our recursive function now that we are normalized.
  return _processSchemaRecurse(bindings, instance, [ root ]);
};


// n.b. we use "uid" here to refer to the user-defined string formId provided
// as part of the XML so as not to confuse it with the autoinc "form.id" field.
const Form = (db) => {
  return class extends Base(db) {
    // convenience getter that just returns the uid.
    get uid() { return this.data.uid; }
    // convenience getter that just returns the xml string.
    get xml() { return this.data.xml; }

    // gets the canonical fields for this form object.
    get fields() {
      const json = xml2js(this.xml, { compact: true });
      return _processFields(jpath.query(json, '$.*.*.model.instance.*')[0]);
    }

    // gets the set of tables implied by this form's nested schema.
    // HACK/TODO: leaking odata stuff.
    get tables() {
      return _extractTables([ [ 'Records', this.fields ] ]);
    }

    // gets the canonical schema for this form object.
    get schema() {
      return _processSchema(xml2js(this.xml, { compact: true }));
    }

    serialize() { return this.data; }

    // given a raw xforms submission body, verify valid fields, pull out vital
    // information, and return an ephemeral Form model object.
    static fromXml(xml) {
      var json = null; // for once js does scoping and it ruins everything.
      try {
        json = xml2js(xml, { compact: true });
      } catch (ex) {
        return new Error("Cannot parse XML."); // xml parsing failed.
      }

      const [ uid ] = jpath.query(json, '$.*.*.model.instance.*._attributes.id');
      if (uid == null)
        return new Error("Cannot find formId."); // required data is missing.

      return new this({ uid, xml });
    }

    // given a uid, returns the single form for that id (or else null).
    static getByUid(uid) {
      return db.select('*').from(this._entityName()).where({ uid }).orderBy('id', 'desc')
        .then((rows) => rows.map((row) => new this(row, false))[0]);
    }

    static _entityName() { return 'forms'; }
  }
}

module.exports = Form;

