const ok = (response, body) => response.status(200).type('text/plain').send(`${body}`);
const notfound = (response) => response.status(404).type('application/json').send({ code: 404, message: "Not found!" });
const bail = (response) => (error) => {
  console.log(error);
  response.status(500).type('text/plain').send(`Something went wrong: ${error.message}`);
};

module.exports = { ok, notfound, bail };

