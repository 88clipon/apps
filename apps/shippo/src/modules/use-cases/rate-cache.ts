import crypto from "node:crypto";

import { DynamoDBDocumentClient, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";

import { createLogger } from "@/lib/logger";
import { DynamoMainTable } from "@/modules/dynamodb/dynamo-main-table";
import { ShippoRate } from "@/modules/shippo/shippo-client";

const logger = createLogger("RateCache");

export type RateCacheKey = {
  saleorApiUrl: string;
  appId: string;
  channelSlug: string;
  country: string;
  postalCode: string;
  /** Bucketed cart weight in ounces (rounded to nearest 4oz) to keep cache hits reasonable. */
  weightBucketOz: number;
};

export type CachedRates = { rates: ShippoRate[]; expiresAt: number };

export interface RateCache {
  get(key: RateCacheKey): Promise<CachedRates | null>;
  set(key: RateCacheKey, value: CachedRates): Promise<void>;
}

const buildKey = (key: RateCacheKey): string => {
  const stable = [key.channelSlug, key.country, key.postalCode, String(key.weightBucketOz)].join(
    "|",
  );
  const hash = crypto.createHash("sha1").update(stable).digest("hex").slice(0, 16);

  return `rate-cache#${hash}`;
};

export const bucketWeight = (ozs: number): number => {
  if (!Number.isFinite(ozs) || ozs <= 0) return 1;

  return Math.ceil(ozs / 4) * 4;
};

/**
 * Fast in-memory cache with a short TTL. Suitable for a single serverless
 * invocation but not durable across cold starts.
 */
export class InMemoryRateCache implements RateCache {
  private readonly store = new Map<string, CachedRates>();

  async get(key: RateCacheKey): Promise<CachedRates | null> {
    const k = buildKey(key);
    const entry = this.store.get(k);

    if (!entry) return null;
    if (entry.expiresAt < Date.now()) {
      this.store.delete(k);

      return null;
    }

    return entry;
  }

  async set(key: RateCacheKey, value: CachedRates): Promise<void> {
    this.store.set(buildKey(key), value);
  }
}

/**
 * DynamoDB-backed cache that survives cold starts. Uses the installation PK
 * and per-key SK, with a TTL attribute so DynamoDB auto-evicts stale entries.
 */
export class DynamoRateCache implements RateCache {
  constructor(
    private readonly table: DynamoMainTable,
    private readonly documentClient: DynamoDBDocumentClient,
  ) {}

  async get(key: RateCacheKey): Promise<CachedRates | null> {
    try {
      const result = await this.documentClient.send(
        new GetCommand({
          TableName: this.table.getName(),
          Key: {
            PK: DynamoMainTable.getPrimaryKeyScopedToInstallation({
              saleorApiUrl: key.saleorApiUrl,
              appId: key.appId,
            }),
            SK: buildKey(key),
          },
        }),
      );

      if (!result.Item) return null;
      const entry = result.Item as { rates?: ShippoRate[]; expiresAt?: number };

      if (!entry.rates || !entry.expiresAt) return null;
      if (entry.expiresAt < Date.now()) return null;

      return { rates: entry.rates, expiresAt: entry.expiresAt };
    } catch (e) {
      logger.warn("Rate cache get failed, treating as miss", { error: e });

      return null;
    }
  }

  async set(key: RateCacheKey, value: CachedRates): Promise<void> {
    try {
      await this.documentClient.send(
        new PutCommand({
          TableName: this.table.getName(),
          Item: {
            PK: DynamoMainTable.getPrimaryKeyScopedToInstallation({
              saleorApiUrl: key.saleorApiUrl,
              appId: key.appId,
            }),
            SK: buildKey(key),
            rates: value.rates,
            expiresAt: value.expiresAt,
            ttl: Math.floor(value.expiresAt / 1000),
          },
        }),
      );
    } catch (e) {
      logger.warn("Rate cache set failed, ignoring", { error: e });
    }
  }
}
