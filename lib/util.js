// generic output handlers.
const ok = (response, body) => response.status(200).type('text/plain').send(`${body}`);
const notfound = (response) => response.status(404).type('application/json').send({ code: 404, message: "Not found!" });
const badrequest = (response, error) => response.status(400).type('application/json').send({ code: 400, message: `Bad request! ${error.message}` });

// absolute failure handler.
const fail = (response) => (error) => {
  console.log(error);
  response.status(500).type('application/json').send({ code: 500, message: error.message });
};

// generic failure handler; attempts to interpret DB exceptions.
const bail = (response) => (error) => {
  if (error.code === '23505')
    badrequest(response, new Error("A record with that unique identifier already exists!"));
  else
    fail(response)(error);
};

module.exports = { ok, notfound, bail };

