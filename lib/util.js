// generic success handlers.
const atom = (obj) => {
  if (typeof obj.serialize === 'function')
    return obj.serialize();
  else
    return obj.toString();
}
const ok = (response, out) => {
  // if only a response is given, curry instead.
  if (out == null)
    return (curry) => ok(response, curry);

  // otherwise attempt to deal nicely with what we are handed.
  if (Array.isArray(out))
    out = out.map((obj) => atom(obj));
  else
    out = atom(out);

  // TODO: actually adjust the mime type.
  response.status(200).type('text/plain').send(out);
}

// generic failure handlers;
const notfound = (response) => response.status(404).type('application/json').send({ code: 404, message: "Not found!" });
const badrequest = (response, error) => response.status(400).type('application/json').send({ code: 400, message: `Bad request! ${error.message}` });

// absolute failure handler.
const fail = (response) => (error) => {
  console.log(error);
  response.status(500).type('application/json').send({ code: 500, message: error.message });
};

// database failure handler; attempts to interpret DB exceptions.
const bail = (response) => (error) => {
  if (error.code === '23505')
    badrequest(response, new Error("A record with that unique identifier already exists!"));
  else
    fail(response)(error);
};


// generic data operations.
const merge = (...objs) => {
  const result = {};
  for (const obj of objs)
    for (const key in obj)
      if (Array.isArray(result[key]) && Array.isArray(obj[key]))
        result[key] = result[key].concat(obj[key]);
      else if (obj[key] != null)
        result[key] = obj[key];
  return result;
};
const get = (obj, path) => {
  for (const x of path) {
    obj = obj[x];
    if (obj == null) return null;
  }
  return obj;
};


// genering string operations.
const sanitize = (x) => x.replace('.', '_');


module.exports = { ok, notfound, badrequest, fail, bail, merge, get, sanitize };

