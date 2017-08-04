const up = (knex) => {
  return knex.schema.createTable('blobs', (blobs) => {
    blobs.increments('id');
    blobs.timestamps();
    blobs.string('body');
  });
};
const down = (knex) => {
  return knex.schema.dropTable('blobs');
};

module.exports = { up, down };

