import { createGraphQLClient } from "@saleor/apps-shared/create-graphql-client";

export const createAuthenticatedGraphQLClient = (args: {
  saleorApiUrl: string;
  token: string;
}) => createGraphQLClient({ saleorApiUrl: args.saleorApiUrl, token: args.token });
