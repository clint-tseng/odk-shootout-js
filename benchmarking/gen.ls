uuid = require('uuid/v4') >> (-> "uuid:#it")
fake = require(\faker)
{ js2xml } = require(\xml-js)
{ post } = require(\request)

[ _, __, total-count, dest-port ] = process.argv
form-id = (new Date()).getTime()

unless total-count?
  console.log('usage: lsc gen.ls total-count dest-port')
  console.log('total-count: number of records to generate')
  console.log('dest-port: port to POST to. if blank, stdout instead')
  process.exit(0)

schema = {
  first: fake.name.firstName
  last: fake.name.lastName
  job:
    employer: fake.company.companyName
    title: fake.name.jobTitle
  phone: fake.phone.phoneNumber
  children: [{
    child:
      first: fake.name.firstName
      last: fake.name.lastName
      usernames: [{ name: fake.internet.userName }]
      friends: [{
        first: fake.name.firstName
        last: fake.name.lastName
        usernames: [{ name: fake.internet.userName }]
      }]
  }]
  usernames: [{ name: fake.internet.userName }]
}

rand = Math.random >> (* 10 + 2) >> Math.floor

base = ->
  id = uuid()
  {
    submission: {
      _attributes: { xmlns: 'http://opendatakit.org/submissions', 'xmlns:orx': 'http://openrosa.org/xforms' }
      data: { data: {
        _attributes: { id: "generated-#form-id", instanceID: id }
        'orx:meta': { 'orx:instanceID': { _text: id } }
      } }
    }
  }

gen = (schema) ->
  result = {}
  for k, v of schema
    result[k] =
      switch typeof! v
      | \Function => { _text: v() }
      | \Object => gen(v)
      | \Array => [ gen(v.0) for to rand() ]
  result

for til total-count
  record = base()
  record.submission.data.data <<< gen(schema)
  xml = js2xml(record, { compact: true })

  if dest-port?
    # WHY ON EARTH IS FORM THE RIGHT OPTION AND NOT BODY OH MY FUC
    (error, response, body) <- post("http://localhost:#dest-port/submission", form: xml )
    console.error(error) if error?
    console.error(body) if response?.status-code isnt 200
  else
    process.stdout.write(xml)

console.log("Wrote #total-count items with id generated-#form-id")

