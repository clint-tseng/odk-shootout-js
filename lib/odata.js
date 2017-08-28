const { merge, sanitize } = require('./util');
const { js2xml } = require('xml-js');

const fqdnBase = 'org.opendatakit.user';

const _edmxEntity = (name, key) => ({
    _attributes: { Name: name },
    Key: { PropertyRef: { _attributes: { Name: key } } },
    Property: [ _edmxProperty(key, 'Edm.String') ]
  });
const _edmxProperty = (name, type) => ({ _attributes: { Name: name, Type: type } });

const _edmxWrapper = (fqdn, nodes) => {
  return {
    _declaration: { _attributes: { version: '1.0', encoding: 'utf-8' } },
    'edmx:Edmx': {
      _attributes: { 'xmlns:edmx': 'http://docs.oasis-open.org/odata/ns/edmx', Version: '4.0' },
      'edmx:DataServices': {
        Schema: merge({ _attributes: {
          'xmlns': 'http://docs.oasis-open.org/odata/ns/edm',
          Namespace: fqdn
        } }, nodes)
      }
    }
  };
};

const _schemaToEdmxRecurse = (target, part, context, fqdn, path) => {
  for (const def of part) {
    if (def.type === 'structure') {
      const subpath = path.concat([ def.key ]);
      const subname = subpath.join('__');
      const inner = { _attributes: { Name: subname }, Property: [] };
      context.ComplexType.push(inner);

      _schemaToEdmxRecurse(inner, def.children, context, fqdn, subpath);
      target.Property.push(_edmxProperty(def.key, `${fqdn}.${subname}`));
    } else if (def.type === 'repeat') {
      const subpath = path.concat([ def.key ]);
      const subname = subpath.join('__');
      const inner = { _attributes: { Name: subname }, Property: [] };
      context.ComplexType.push(inner);

      /*const inner = _edmxEntity(subname, `${subname}Id`);
      context.EntityType.push(inner);*/

      _schemaToEdmxRecurse(inner, def.children, context, fqdn, subpath);
      target.Property.push(_edmxProperty(def.key, `Collection(${fqdn}.${subname})`));
    } else if (def.type === 'int') {
      target.Property.push(_edmxProperty(def.key, 'Edm.Int64'));
    } else if (def.type === 'decimal') {
      target.Property.push(_edmxProperty(def.key, 'Edm.Decimal'));
    } else if (def.type === 'geopoint') {
      target.Property.push(_edmxProperty(def.key, 'Edm.GeographyPoint'));
    } else {
      target.Property.push(_edmxProperty(def.key, 'Edm.String'));
    }
  }
};

const schemaToEdmx = (formId, schema) => {
  let fqdn = `${fqdnBase}.${sanitize(formId)}`;
  let base = _edmxEntity('Record', 'instanceId');
  let baseSet = { _attributes: { Name: 'Records', EntityType: `${fqdn}.Record` } };
  let context = { EntityType: [ base ], ComplexType: [], EntitySet: [ baseSet ] };

  // recursively walk our schema; context contains our xml nodes that will be
  // mutated as the walk occurs.
  _schemaToEdmxRecurse(base, schema, context, fqdn, []);

  // move EntitySet to its appropriate final home.
  context.EntityContainer = {
    _attributes: { Name: 'Container' },
    EntitySet: context.EntitySet
  };
  delete context.EntitySet;

  // wrap the generated nodes and output as xml.
  return js2xml(_edmxWrapper(fqdn, context), { compact: true });
};

module.exports = { schemaToEdmx };

