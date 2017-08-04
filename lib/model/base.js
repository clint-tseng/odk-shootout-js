const Base = (db) => {
  return class {
    constructor(data, ephemeral = true) {
      this.data = data;
      this._ephemeral = ephemeral;
    }

    // persists data record to database as-is.
    // returns the id of the created record.
    save() {
      if (this._ephemeral === true) {
        return db.insert(this.data).into(this._entityName()).returning('id').then((result) => result[0]);
      } else {
        if (this.data.id == null) throw new Error("trying to update a record that does not exist!");
        return db.update(this.data).into(this._entityName()).where({ id: this.data.id }).then((result) => result.rowCount === 1);
      }
    }

    // generic basic detail static methods.
    static getById(id) {
      return db.select('*').from(this._entityName()).where({ id }).then((rows) => new this(rows[0], false));
    }
    static getCount(condition = {}) {
      return db.count('*').from(this._entityName()).where(condition).then((result) => Number(result[0].count));
    }

    // used by the generic database functions to understand what table to use.
    static _entityName() { return 'base'; }
    _entityName() { return this.constructor._entityName(); }
  }
}

module.exports = Base;

