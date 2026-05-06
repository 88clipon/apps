import { env } from "@/lib/env";
import { dynamoMainTable } from "@/modules/dynamodb/dynamo-main-table";
import {
  createDynamoDBClient,
  createDynamoDBDocumentClient,
} from "@/modules/dynamodb/dynamodb-client";
import {
  DynamoIdempotencyStore,
  IdempotencyStore,
  InMemoryIdempotencyStore,
} from "@/modules/idempotency/idempotency-store";

import {
  DynamoOrderLinkStore,
  InMemoryOrderLinkStore,
  OrderLinkStore,
} from "./order-link-store";

let cachedIdemStore: IdempotencyStore | null = null;
let cachedOrderLinkStore: OrderLinkStore | null = null;

const useDynamo = () => env.APL === "dynamodb";

export const idempotencyStore = (): IdempotencyStore => {
  if (cachedIdemStore) return cachedIdemStore;
  if (useDynamo()) {
    const client = createDynamoDBClient();
    const doc = createDynamoDBDocumentClient(client);

    cachedIdemStore = new DynamoIdempotencyStore(dynamoMainTable, doc);
  } else {
    cachedIdemStore = new InMemoryIdempotencyStore();
  }

  return cachedIdemStore;
};

export const orderLinkStore = (): OrderLinkStore => {
  if (cachedOrderLinkStore) return cachedOrderLinkStore;
  if (useDynamo()) {
    const client = createDynamoDBClient();
    const doc = createDynamoDBDocumentClient(client);

    cachedOrderLinkStore = new DynamoOrderLinkStore(dynamoMainTable, doc);
  } else {
    cachedOrderLinkStore = new InMemoryOrderLinkStore();
  }

  return cachedOrderLinkStore;
};
