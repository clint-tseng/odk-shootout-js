const Base = require('./base');

const Blob = (db) => {
  return class extends Base(db) {
    get body() { return this.data.body; }

    static _entityName() { return 'blobs'; }
  }
}

module.exports = Blob;

