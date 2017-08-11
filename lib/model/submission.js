const Base = require('./base');
const { xml2js } = require('xml-js');
const jpath = require('jsonpath');

const Submission = (db) => {
  return class extends Base(db) {
    get xml() { return this.data.xml; }

    serialize() { return this.data; }

    // given a raw xforms submission body, verify valid fields, pull out vital
    // information, and return an ephemeral Submission model object.
    static fromXml(xml) {
      var json = null; // for once js does scoping and it ruins everything.
      try {
        json = xml2js(xml, { compact: true });
      } catch (ex) {
        return new Error("Cannot parse XML."); // xml parsing failed.
      }

      const [ form_id ] = jpath.query(json, '$.submission.data.*._attributes.id');
      const [ raw_instance_id ] = jpath.query(json, '$.submission.data.*._attributes.instanceID');
      if ((form_id == null) || (raw_instance_id == null))
        return new Error("Cannot find formId or instanceId."); // required data is missing.

      const instance_id = /^uuid:(.*)$/i.exec(raw_instance_id)[1];
      if (instance_id == null)
        return new Error("Unrecognized instanceId format."); // unknown instanceID format.

      return new this({ form_id, instance_id, xml });
    }

    // returns a partial knex query for listing all submissions matching a formId.
    static queryByFormId(form_id) {
      return db.select('*').from(this._entityName()).where({ form_id }).orderBy('id', 'desc');
    }

    // given a formId, gets a list of all submissions matching that formId.
    static listByFormId(form_id) {
      return this.queryByFormId(form_id).then((rows) => rows.map((row) => new this(row, false)));
    }

    // given both a formId and a submissionId, gets the single record for that pair.
    static getSingle(form_id, instance_id) {
      return db.select('*').from(this._entityName()).where({ form_id, instance_id })
        .then((rows) => rows.map((row) => new this(row, false))[0]);
    }

    static _entityName() { return 'submissions'; }
  }
}

module.exports = Submission;

