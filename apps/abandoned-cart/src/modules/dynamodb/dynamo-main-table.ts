import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { Table } from "dynamodb-toolbox";

import { env } from "@/lib/env";
import {
  createDynamoDBClient,
  createDynamoDBDocumentClient,
} from "@/modules/dynamodb/dynamodb-client";

type PartitionKey = { name: "PK"; type: "string" };
type SortKey = { name: "SK"; type: "string" };

/**
 * Main table for the Abandoned-cart app: stores APL data, the merchant's app
 * config row, and one row per tracked checkout (carts + per-reminder send
 * state + recovered/unsubscribed flags). Rows are auto-expired via DynamoDB's
 * `ttl` attribute when retention elapses.
 */
export class DynamoMainTable extends Table<PartitionKey, SortKey> {
  private constructor(args: ConstructorParameters<typeof Table<PartitionKey, SortKey>>[number]) {
    super(args);
  }

  static create({
    documentClient,
    tableName,
  }: {
    documentClient: DynamoDBDocumentClient;
    tableName: string;
  }): DynamoMainTable {
    return new DynamoMainTable({
      documentClient,
      name: tableName,
      partitionKey: { name: "PK", type: "string" },
      sortKey: { name: "SK", type: "string" },
    });
  }

  /**
   * Scoped to a specific installation (saleorApiUrl + appId).
   * Use for: configs, mappings, rate cache, idempotency.
   */
  static getPrimaryKeyScopedToInstallation({
    saleorApiUrl,
    appId,
  }: {
    saleorApiUrl: string;
    appId: string;
  }): `${string}#${string}` {
    return `${saleorApiUrl}#${appId}` as const;
  }

  /**
   * Scoped to a tenant. Used by the APL so it survives reinstalls.
   */
  static getPrimaryKeyScopedToSaleorApiUrl({
    saleorApiUrl,
  }: {
    saleorApiUrl: string;
  }): `${string}` {
    return `${saleorApiUrl}` as const;
  }
}

const tableName = env.DYNAMODB_MAIN_TABLE_NAME ?? "abandoned-cart-app-main";
const client = createDynamoDBClient();

export const dynamoDocumentClient = createDynamoDBDocumentClient(client);

export const dynamoMainTable = DynamoMainTable.create({
  documentClient: dynamoDocumentClient,
  tableName,
});
