const up = (knex) => {
  return knex.schema.table('forms', (forms) => {
    forms.unique('uid');
  }).then(knex.schema.table('submissions', (submissions) => {
    submissions.foreign('uid').references('forms.uid');
  }));
};
const down = (knex) => {
  return knex.schema.table('submissions', (submissions) => {
    submissions.dropForeign('uid');
  }).then(knex.schema.table('forms', (forms) => {
    forms.dropUnique('uid');
  }));
};

module.exports = { up, down };

