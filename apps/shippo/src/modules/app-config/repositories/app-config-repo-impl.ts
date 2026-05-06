import { env } from "@/lib/env";
import { dynamoMainTable } from "@/modules/dynamodb/dynamo-main-table";
import {
  createDynamoDBClient,
  createDynamoDBDocumentClient,
} from "@/modules/dynamodb/dynamodb-client";

import { AppConfigRepo } from "./app-config-repo";
import { AppConfigRepoDynamoDB } from "./app-config-repo-dynamodb";
import { AppConfigRepoMemory } from "./app-config-repo-memory";

const buildRepo = (): AppConfigRepo => {
  if (env.APL === "dynamodb") {
    const client = createDynamoDBClient();
    const docClient = createDynamoDBDocumentClient(client);

    return new AppConfigRepoDynamoDB(dynamoMainTable, docClient);
  }

  return new AppConfigRepoMemory();
};

export const appConfigRepoImpl: AppConfigRepo = buildRepo();
