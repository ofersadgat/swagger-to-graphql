'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.mapParametersToFields = exports.jsonSchemaTypeToGraphQL = exports.getTypeFields = exports.createGQLObject = undefined;

var _stringify = require('babel-runtime/core-js/json/stringify');

var _stringify2 = _interopRequireDefault(_stringify);

var _keys = require('babel-runtime/core-js/object/keys');

var _keys2 = _interopRequireDefault(_keys);

var _lodash = require('lodash');

var _lodash2 = _interopRequireDefault(_lodash);

var _graphql = require('graphql');

var graphql = _interopRequireWildcard(_graphql);

var _graphqlTypeJson = require('graphql-type-json');

var _graphqlTypeJson2 = _interopRequireDefault(_graphqlTypeJson);

var _swagger = require('./swagger');

function _interopRequireWildcard(obj) { if (obj && obj.__esModule) { return obj; } else { var newObj = {}; if (obj != null) { for (var key in obj) { if (Object.prototype.hasOwnProperty.call(obj, key)) newObj[key] = obj[key]; } } newObj.default = obj; return newObj; } }

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

var primitiveTypes = {
  string: graphql.GraphQLString,
  date: graphql.GraphQLString,
  integer: graphql.GraphQLInt,
  number: graphql.GraphQLFloat,
  boolean: graphql.GraphQLBoolean,
  object: _graphqlTypeJson2.default
};

var isObjectType = function isObjectType(jsonSchema) {
  return jsonSchema && (jsonSchema.properties || jsonSchema.type === 'object' || jsonSchema.type === 'array' || jsonSchema.schema);
};

var getTypeNameFromRef = function getTypeNameFromRef(ref) {
  var cutRef = ref.replace('#/definitions/', '');
  return cutRef.replace(/\//, '_');
};

var getExistingType = function getExistingType(ref, isInputType, gqlTypes) {
  var refTypeName = getTypeNameFromRef(ref);
  var typeName = refTypeName;
  if (isInputType && !typeName.endsWith('Input')) {
    typeName = typeName + 'Input';
  }
  var allSchema = (0, _swagger.getSchema)();
  if (!gqlTypes[typeName]) {
    var schema = allSchema.definitions[refTypeName];
    if (!schema) {
      throw new Error('Definition ' + refTypeName + ' was not found in schema');
    }
    return createGQLObject(schema, refTypeName, isInputType, gqlTypes);
  }
  return gqlTypes[typeName];
};

var getRefProp = function getRefProp(jsonSchema) {
  return jsonSchema.$ref || jsonSchema.schema && jsonSchema.schema.$ref;
};

var createGQLObject = exports.createGQLObject = function createGQLObject(jsonSchema, title, isInputType, gqlTypes) {
  title = jsonSchema && jsonSchema.title || title || ''; // eslint-disable-line no-param-reassign

  if (isInputType && !title.endsWith('Input')) {
    title = title + 'Input'; // eslint-disable-line no-param-reassign
    jsonSchema = _lodash2.default.clone(jsonSchema); // eslint-disable-line no-param-reassign
  }

  if (title in gqlTypes) {
    return gqlTypes[title];
  }

  if (!jsonSchema || (0, _keys2.default)(jsonSchema).length === 0) {
    gqlTypes.JSON = _graphqlTypeJson2.default;
    gqlTypes[title] = _graphqlTypeJson2.default;
    return _graphqlTypeJson2.default;
  } else if (!jsonSchema.title) {
    jsonSchema.title = title;
  }

  var reference = getRefProp(jsonSchema);

  if (reference) {
    return getExistingType(reference, isInputType, gqlTypes);
  }

  if (jsonSchema.type === 'array') {
    if (jsonSchema.items && jsonSchema.items.$ref) {
      return new graphql.GraphQLList(getExistingType(jsonSchema.items.$ref, isInputType, gqlTypes));
    } else if (jsonSchema.items && jsonSchema.items.schema) {
      return new graphql.GraphQLList(createGQLObject(jsonSchema.items.schema, title + '_items', isInputType, gqlTypes));
    } else if (isObjectType(jsonSchema.items)) {
      return new graphql.GraphQLList(createGQLObject(jsonSchema.items, title + '_items', isInputType, gqlTypes));
    } else if (!jsonSchema.items) {
      return new graphql.GraphQLList(_graphqlTypeJson2.default);
    }

    return new graphql.GraphQLList(getPrimitiveTypes(jsonSchema.items));
  } else if (jsonSchema.type !== '' && jsonSchema.type !== 'object' && jsonSchema.type) {
    return getPrimitiveTypes(jsonSchema);
  }

  var description = jsonSchema.description;
  var fields = getTypeFields(jsonSchema, title, isInputType, gqlTypes);
  var result = void 0;
  if (isInputType) {
    result = new graphql.GraphQLInputObjectType({
      name: title,
      description: description,
      fields: fields
    });
  } else {
    result = new graphql.GraphQLObjectType({
      name: title,
      description: description,
      fields: fields
    });
  }
  gqlTypes[title] = result;
  return result;
};

var getTypeFields = exports.getTypeFields = function getTypeFields(jsonSchema, title, isInputType, gqlTypes) {
  if (!(0, _keys2.default)(jsonSchema.properties || {}).length) {
    return {
      empty: {
        description: 'default field',
        type: graphql.GraphQLString
      }
    };
  }
  return function () {
    return _lodash2.default.mapValues(jsonSchema.properties || {}, function (propertySchema, propertyName) {
      return {
        description: propertySchema.description,
        type: jsonSchemaTypeToGraphQL(propertySchema, title + '_' + propertyName, isInputType, gqlTypes)
      };
    });
  };
};

var createUnionType = function createUnionType(jsonSchema, title, isInputType, gqlTypes) {
  title = jsonSchema && jsonSchema.title || title || ''; // eslint-disable-line no-param-reassign

  if (isInputType && !title.endsWith('Input')) {
    title = title + 'Input'; // eslint-disable-line no-param-reassign
    jsonSchema = _lodash2.default.clone(jsonSchema); // eslint-disable-line no-param-reassign
  }

  jsonSchema.title = title;

  if (title in gqlTypes) {
    return gqlTypes[title];
  }

  var types = jsonSchema.anyOf.map(function (schema) {
    return jsonSchemaTypeToGraphQL(schema, undefined, isInputType, gqlTypes);
  });
  var result = new graphql.GraphQLUnionType({
    name: title,
    types: types,
    resolveType: function resolveType(value) {
      for (var i = 0; i < types.length; i++) {
        var type = types[i];
        if (value instanceof type) {
          return type;
        }
      }
      return undefined;
    }
  });
  gqlTypes[title] = result;
  return result;
};

var jsonSchemaTypeToGraphQL = exports.jsonSchemaTypeToGraphQL = function jsonSchemaTypeToGraphQL(jsonSchema, title, isInputType, gqlTypes) {
  if (!jsonSchema) {
    return null;
  } else if (jsonSchema.$ref) {
    return getExistingType(jsonSchema.$ref, isInputType, gqlTypes);
  } else if (jsonSchema.anyOf) {
    return createUnionType(jsonSchema, title, isInputType, gqlTypes);
  } else if (jsonSchema.type === 'object' || jsonSchema.schema) {
    return createGQLObject(jsonSchema.schema, title, isInputType, gqlTypes);
  } else if (jsonSchema.type === 'array') {
    return createGQLObject(jsonSchema, title, isInputType, gqlTypes);
  } else if (jsonSchema.type) {
    return getPrimitiveTypes(jsonSchema);
  }
  throw new Error("Don't know how to handle schema " + (0, _stringify2.default)(jsonSchema) + ' without type and schema');
};

var getPrimitiveTypes = function getPrimitiveTypes(jsonSchema) {
  var jsonType = jsonSchema.type;
  var format = jsonSchema.format;
  if (format === 'int64') {
    jsonType = 'string';
  }
  var type = primitiveTypes[jsonType];
  if (!type) {
    throw new Error('Cannot build primitive type "' + jsonType + '"');
  }
  return type;
};

var mapParametersToFields = exports.mapParametersToFields = function mapParametersToFields(parameters, typeName, gqlTypes) {
  return parameters.reduce(function (res, param) {
    var type = jsonSchemaTypeToGraphQL(param.jsonSchema, 'param_' + typeName + '_' + param.name, true, gqlTypes);
    res[param.name] = {
      type: type
    };
    return res;
  }, {});
};
