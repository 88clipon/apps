import { env } from "@/lib/env";
import { dynamoDocumentClient, dynamoMainTable } from "@/modules/dynamodb/dynamo-main-table";

import { AbandonedCartRepo } from "./repo";
import { AbandonedCartRepoDynamoDB } from "./repo-dynamodb";
import { AbandonedCartRepoMemory } from "./repo-memory";

/**
 * Process-wide singleton picked at boot. Production uses DynamoDB; dev with
 * APL=file uses the in-memory implementation (so contributors don't need an
 * AWS account to run the app locally).
 */
export const repoImpl: AbandonedCartRepo =
  env.APL === "dynamodb"
    ? new AbandonedCartRepoDynamoDB(dynamoMainTable, dynamoDocumentClient)
    : new AbandonedCartRepoMemory();
