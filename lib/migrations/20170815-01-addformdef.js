const up = (knex) => {
  return knex.schema.createTable('forms', (forms) => {
    forms.increments('id');
    forms.timestamps();
    forms.string('uid').notNull();
    forms.text('xml');

    forms.index('uid');
  });
};
const down = (knex) => {
  return knex.schema.dropTable('forms');
};

module.exports = { up, down };

