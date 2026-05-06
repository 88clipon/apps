import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";

import { createLogger } from "@/lib/logger";
import { DynamoMainTable } from "@/modules/dynamodb/dynamo-main-table";

const logger = createLogger("IdempotencyStore");

export interface IdempotencyStore {
  /** Returns true if this event has never been processed before, false if duplicate. */
  tryLock(args: {
    saleorApiUrl: string;
    appId: string;
    eventId: string;
    ttlSeconds?: number;
  }): Promise<boolean>;
}

/**
 * Simple in-memory idempotency store for local dev / tests. Not safe across
 * serverless invocations.
 */
export class InMemoryIdempotencyStore implements IdempotencyStore {
  private readonly seen = new Set<string>();

  async tryLock(args: { saleorApiUrl: string; appId: string; eventId: string }): Promise<boolean> {
    const k = `${args.saleorApiUrl}#${args.appId}#${args.eventId}`;

    if (this.seen.has(k)) return false;
    this.seen.add(k);

    return true;
  }
}

/**
 * DynamoDB-backed idempotency store using a conditional PutItem that fails
 * when the key already exists. Entries auto-expire via a TTL attribute.
 */
export class DynamoIdempotencyStore implements IdempotencyStore {
  constructor(
    private readonly table: DynamoMainTable,
    private readonly documentClient: DynamoDBDocumentClient,
  ) {}

  async tryLock(args: {
    saleorApiUrl: string;
    appId: string;
    eventId: string;
    ttlSeconds?: number;
  }): Promise<boolean> {
    const ttl = Math.floor(Date.now() / 1000) + (args.ttlSeconds ?? 60 * 60 * 24 * 7);

    try {
      await this.documentClient.send(
        new PutCommand({
          TableName: this.table.getName(),
          Item: {
            PK: DynamoMainTable.getPrimaryKeyScopedToInstallation({
              saleorApiUrl: args.saleorApiUrl,
              appId: args.appId,
            }),
            SK: `idem#${args.eventId}`,
            ttl,
          },
          ConditionExpression: "attribute_not_exists(SK)",
        }),
      );

      return true;
    } catch (e) {
      if (e instanceof ConditionalCheckFailedException) {
        logger.debug("Duplicate webhook event", { eventId: args.eventId });

        return false;
      }
      /**
       * Fail-open on DynamoDB errors: better to double-process than drop a
       * legitimate webhook. Saleor's own orderFulfill/updateTracking calls
       * are idempotent enough that double-processing rarely hurts.
       */
      logger.warn("Idempotency store error; proceeding without lock", { error: e });

      return true;
    }
  }
}
