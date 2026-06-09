import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

export const createDynamoDBClient = () => {
  return new DynamoDBClient();
};

export const createDynamoDBDocumentClient = (client: DynamoDBClient) => {
  return DynamoDBDocumentClient.from(client, {
    marshallOptions: {
      /** Avoid PutItem failures when optional APL fields (e.g. jwks) are undefined. */
      removeUndefinedValues: true,
    },
  });
};
