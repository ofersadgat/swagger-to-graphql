// @flow
import type {GraphQLType, JSONSchemaType, EndpointParam, GraphQLTypeMap} from './types';
import type {GraphQLScalarType} from 'graphql/type/definition.js.flow';
import _ from 'lodash';
import * as graphql from 'graphql';
import GraphQLJSON from 'graphql-type-json';
import {getSchema} from './swagger';

const primitiveTypes = {
  string: graphql.GraphQLString,
  date: graphql.GraphQLString,
  integer: graphql.GraphQLInt,
  number: graphql.GraphQLFloat,
  boolean: graphql.GraphQLBoolean,
  object: GraphQLJSON,
  JSON: GraphQLJSON,
};

const isObjectType = (jsonSchema) =>
  jsonSchema && (jsonSchema.properties || jsonSchema.type === 'object' || jsonSchema.type === 'array' || jsonSchema.schema);

const getTypeNameFromRef = (ref: string) => {
  const cutRef = ref.replace('#/definitions/', '');
  return cutRef.replace(/\//, '_');
};

const getExistingType = (ref: string, isInputType: boolean, gqlTypes: GraphQLTypeMap) => {
  const refTypeName = getTypeNameFromRef(ref);
  let typeName = refTypeName;
  if (isInputType && !typeName.endsWith('Input')) {
    typeName = typeName + 'Input';
  }
  const allSchema = getSchema();
  if (!gqlTypes[typeName]) {
    const schema = allSchema.definitions[refTypeName];
    if (!schema) {
      throw new Error(`Definition ${refTypeName} was not found in schema`);
    }
    return createGQLObject(schema, refTypeName, isInputType, gqlTypes);
  }
  return gqlTypes[typeName];
};

const getRefProp = (jsonSchema: JSONSchemaType) => {
  return jsonSchema.$ref || (jsonSchema.schema && jsonSchema.schema.$ref);
};

export const createGQLObject = (jsonSchema: JSONSchemaType, title: string, isInputType: boolean, gqlTypes: GraphQLTypeMap): GraphQLType => {
  title = (jsonSchema && jsonSchema.title) || title || '';  // eslint-disable-line no-param-reassign

  if (isInputType && !title.endsWith('Input')) {
    title = title + 'Input'; // eslint-disable-line no-param-reassign
    jsonSchema = _.clone(jsonSchema);  // eslint-disable-line no-param-reassign
  }

  if (title in gqlTypes) {
    return gqlTypes[title];
  }

  if (!jsonSchema || Object.keys(jsonSchema).length === 0) {
    gqlTypes.JSON = GraphQLJSON;
    gqlTypes[title] = GraphQLJSON;
    return GraphQLJSON;
  } else if (!jsonSchema.title) {
    jsonSchema.title = title;
  }

  let reference = getRefProp(jsonSchema);

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
      return new graphql.GraphQLList(GraphQLJSON);
    }

    return new graphql.GraphQLList(getPrimitiveTypes(jsonSchema.items));
  } else if (jsonSchema.type !== '' && (jsonSchema.type !== 'object' || !jsonSchema.properties) && jsonSchema.type) {
    return getPrimitiveTypes(jsonSchema);
  }

  const description = jsonSchema.description;
  const fields = getTypeFields(jsonSchema, title, isInputType, gqlTypes);
  let result;
  if (isInputType) {
    result = new graphql.GraphQLInputObjectType({
      name: title,
      description,
      fields
    });
  } else {
    result = new graphql.GraphQLObjectType({
      name: title,
      description,
      fields
    });
  }
  gqlTypes[title] = result;
  return result;
};


export const getTypeFields = (jsonSchema: JSONSchemaType, title: string, isInputType: boolean, gqlTypes: GraphQLTypeMap) => {
  if (!Object.keys(jsonSchema.properties || {}).length) {
    return {
      empty: {
        description: 'default field',
        type: graphql.GraphQLString
      }
    };
  }
  return () =>
    _.mapValues(jsonSchema.properties || {}, (propertySchema, propertyName) => {
      return {
        description: propertySchema.description,
        type: jsonSchemaTypeToGraphQL(propertySchema, title + '_' + propertyName, isInputType, gqlTypes)
      };
    });
};

const createUnionType = (jsonSchema: JSONSchemaType, title: string, isInputType: boolean, gqlTypes: GraphQLTypeMap) => {
  title = (jsonSchema && jsonSchema.title) || title || '';  // eslint-disable-line no-param-reassign

  if (isInputType && !title.endsWith('Input')) {
    title = title + 'Input'; // eslint-disable-line no-param-reassign
    jsonSchema = _.clone(jsonSchema);  // eslint-disable-line no-param-reassign
  }

  jsonSchema.title = title;

  if (title in gqlTypes) {
    return gqlTypes[title];
  }

  let types = jsonSchema.anyOf.map((schema) => {
    return jsonSchemaTypeToGraphQL(schema, undefined, isInputType, gqlTypes);
  });
  let result = new graphql.GraphQLUnionType({
    name: title,
    types: types,
    resolveType: (value) => {
      for (let i = 0; i < types.length; i++) {
        let type = types[i];
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

export const jsonSchemaTypeToGraphQL = (jsonSchema: JSONSchemaType, title: string, isInputType: boolean, gqlTypes: GraphQLTypeMap) => {
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
  throw new Error("Don't know how to handle schema " + JSON.stringify(jsonSchema) + ' without type and schema');
};

const getPrimitiveTypes = (jsonSchema: JSONSchemaType): GraphQLScalarType => {
  let jsonType = jsonSchema.type;
  const format = jsonSchema.format;
  if (format === 'int64') {
    jsonType = 'string';
  }
  const type = primitiveTypes[jsonType];
  if (!type) {
    throw new Error(`Cannot build primitive type "${jsonType}"`);
  }
  return type;
};

export const mapParametersToFields = (parameters: Array<EndpointParam>, typeName: string, gqlTypes: GraphQLTypeMap) => {
  return parameters.reduce((res, param) => {
    const type = jsonSchemaTypeToGraphQL(param.jsonSchema, 'param_' + typeName + '_' + param.name, true, gqlTypes);
    res[param.name] = {
      type
    };
    return res;
  }, {});
};
