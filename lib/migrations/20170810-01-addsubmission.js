const up = (knex) => {
  return knex.schema.createTable('submissions', (submissions) => {
    submissions.increments('id');
    submissions.timestamps();
    submissions.string('form_id').notNull();
    submissions.string('instance_id').unique().notNull();
    submissions.text('xml');

    submissions.index('form_id');
  });
};
const down = (knex) => {
  return knex.schema.dropTable('submissions');
};

module.exports = { up, down };

