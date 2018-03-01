// @flow
import type {GraphQLParameters, Endpoint, GraphQLType, RootGraphQLSchema, SwaggerToGraphQLOptions, GraphQLTypeMap} from './types';
import rp from 'request-promise';
import { GraphQLSchema, GraphQLObjectType } from 'graphql';
import { getAllEndPoints, loadSchema } from './swagger';
import { createGQLObject, jsonSchemaTypeToGraphQL, mapParametersToFields } from './typeMap';

type Endpoints = {[string]: Endpoint};

const schemaFromEndpoints = (endpoints: Endpoints, proxyUrl, headers) => {
  const gqlTypes = {};
  const queryFields = getFields(endpoints, false, gqlTypes, proxyUrl, headers);
  if (!Object.keys(queryFields).length) {
    throw new Error('Did not find any GET endpoints');
  }
  const rootType = new GraphQLObjectType({
    name: 'Query',
    fields: queryFields
  });

  const graphQLSchema: RootGraphQLSchema = {
    query: rootType
  };

  const mutationFields = getFields(endpoints, true, gqlTypes, proxyUrl, headers);
  if (Object.keys(mutationFields).length) {
    graphQLSchema.mutation = new GraphQLObjectType({
      name: 'Mutation',
      fields: mutationFields
    });
  }

  return new GraphQLSchema(graphQLSchema);
};

const resolver = (endpoint: Endpoint, proxyUrl: ?(Function | string), customHeaders = {}) =>
  async (_, args: GraphQLParameters, opts: SwaggerToGraphQLOptions) => {
    const proxy = !proxyUrl ? opts && opts.GQLProxyBaseUrl : (typeof proxyUrl === 'function' ? proxyUrl(opts) : proxyUrl);
    const req = endpoint.request(args, proxy);
    if (opts && opts.headers) {
      req.headers = Object.assign(customHeaders, req.headers, opts.headers);
    }
    const res = await rp(req);
    return JSON.parse(res);
  };

const getFields = (endpoints, isMutation, gqlTypes, proxyUrl, headers): GraphQLTypeMap => {
  return Object.keys(endpoints).filter((typeName: string) => {
    return !!endpoints[typeName].mutation === !!isMutation;
  }).reduce((result, typeName) => {
    const endpoint = endpoints[typeName];
    const type = endpoint.response ?
      jsonSchemaTypeToGraphQL({schema: endpoint.response}, typeName, false, gqlTypes) :
      createGQLObject({type: 'object'}, 'None', false, gqlTypes);
    const gType: GraphQLType = {
      type,
      description: endpoint.description,
      args: mapParametersToFields(endpoint.parameters, typeName, gqlTypes),
      resolve: resolver(endpoint, proxyUrl, headers)
    };
    result[typeName] = gType;
    return result;
  }, {});
};

const build = async (swaggerPath: string, proxyUrl: ?(Function | string) = null, headers: ?{[string]: string}) => {
  const swaggerSchema = await loadSchema(swaggerPath);
  const endpoints = getAllEndPoints(swaggerSchema);
  const schema = schemaFromEndpoints(endpoints, proxyUrl, headers);
  return schema;
};

export default build;
