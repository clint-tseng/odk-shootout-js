const Base = require('./base');
const { xml2js } = require('xml-js');
const jpath = require('jsonpath');

// n.b. we use "uid" here to refer to the user-defined string formId provided
// as part of the XML so as not to confuse it with the autoinc "form.id" field.
const Form = (db) => {
  return class extends Base(db) {
    get xml() { return this.data.xml; }

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

