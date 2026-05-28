import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import { err, ok, Result } from "neverthrow";

import { createLogger } from "@/lib/logger";
import {
  AppConfig,
  appConfigSchema,
} from "@/modules/app-config/domain/app-config";
import {
  CartRecord,
  cartRecordSchema,
} from "@/modules/app-config/domain/cart-record";
import { DynamoMainTable } from "@/modules/dynamodb/dynamo-main-table";

import { AbandonedCartRepo, BaseAccess, RepoError } from "./repo";

const logger = createLogger("AbandonedCartRepoDynamoDB");

const CONFIG_SK = "config";
const CART_SK_PREFIX = "cart#";
const toCartSk = (checkoutId: string) => `${CART_SK_PREFIX}${checkoutId}`;

export class AbandonedCartRepoDynamoDB implements AbandonedCartRepo {
  constructor(
    private readonly table: DynamoMainTable,
    private readonly documentClient: DynamoDBDocumentClient,
  ) {}

  private pk(access: BaseAccess): string {
    return DynamoMainTable.getPrimaryKeyScopedToInstallation(access);
  }

  async getConfig(
    access: BaseAccess,
  ): Promise<Result<AppConfig | null, InstanceType<typeof RepoError.FailureFetching>>> {
    try {
      const res = await this.documentClient.send(
        new GetCommand({
          TableName: this.table.getName(),
          Key: { PK: this.pk(access), SK: CONFIG_SK },
        }),
      );

      if (!res.Item?.config) return ok(null);
      const parsed = appConfigSchema.safeParse(res.Item.config);

      if (!parsed.success) {
        logger.warn("Stored config failed validation", { issues: parsed.error.issues });

        return ok(null);
      }
      const created = AppConfig.create(parsed.data);

      if (created.isErr()) {
        return err(
          new RepoError.FailureFetching("Invalid stored config", { cause: created.error }),
        );
      }

      return ok(created.value);
    } catch (cause) {
      logger.error("Failed to fetch config", { error: cause });

      return err(new RepoError.FailureFetching("Failed to fetch config", { cause }));
    }
  }

  async saveConfig(args: {
    access: BaseAccess;
    config: AppConfig;
  }): Promise<Result<void, InstanceType<typeof RepoError.FailureSaving>>> {
    try {
      await this.documentClient.send(
        new PutCommand({
          TableName: this.table.getName(),
          Item: {
            PK: this.pk(args.access),
            SK: CONFIG_SK,
            config: args.config.toJSON(),
          },
        }),
      );

      return ok(undefined);
    } catch (cause) {
      logger.error("Failed to save config", { error: cause });

      return err(new RepoError.FailureSaving("Failed to save config", { cause }));
    }
  }

  async getCart(args: {
    access: BaseAccess;
    checkoutId: string;
  }): Promise<Result<CartRecord | null, InstanceType<typeof RepoError.FailureFetching>>> {
    try {
      const res = await this.documentClient.send(
        new GetCommand({
          TableName: this.table.getName(),
          Key: { PK: this.pk(args.access), SK: toCartSk(args.checkoutId) },
        }),
      );

      if (!res.Item?.cart) return ok(null);
      const parsed = cartRecordSchema.safeParse(res.Item.cart);

      if (!parsed.success) {
        logger.warn("Stored cart record failed validation", { issues: parsed.error.issues });

        return ok(null);
      }
      const created = CartRecord.create(parsed.data);

      if (created.isErr()) {
        return err(
          new RepoError.FailureFetching("Invalid stored cart", { cause: created.error }),
        );
      }

      return ok(created.value);
    } catch (cause) {
      logger.error("Failed to fetch cart", { error: cause });

      return err(new RepoError.FailureFetching("Failed to fetch cart", { cause }));
    }
  }

  async saveCart(args: {
    access: BaseAccess;
    cart: CartRecord;
  }): Promise<Result<void, InstanceType<typeof RepoError.FailureSaving>>> {
    try {
      await this.documentClient.send(
        new PutCommand({
          TableName: this.table.getName(),
          Item: {
            PK: this.pk(args.access),
            SK: toCartSk(args.cart.checkoutId),
            cart: args.cart.toJSON(),
            /*
             * Mirror to the row's top-level `ttl` attribute so DynamoDB's TTL
             * sweeper can find it (it doesn't traverse nested maps).
             */
            ttl: args.cart.ttl,
          },
        }),
      );

      return ok(undefined);
    } catch (cause) {
      logger.error("Failed to save cart", { error: cause });

      return err(new RepoError.FailureSaving("Failed to save cart", { cause }));
    }
  }

  async listLiveCarts(
    access: BaseAccess,
  ): Promise<Result<CartRecord[], InstanceType<typeof RepoError.FailureFetching>>> {
    try {
      const items = await this.documentClient.send(
        new QueryCommand({
          TableName: this.table.getName(),
          KeyConditionExpression: "#pk = :pk AND begins_with(#sk, :sk_prefix)",
          ExpressionAttributeNames: { "#pk": "PK", "#sk": "SK" },
          ExpressionAttributeValues: {
            ":pk": this.pk(access),
            ":sk_prefix": CART_SK_PREFIX,
          },
        }),
      );

      const carts: CartRecord[] = [];

      for (const item of items.Items ?? []) {
        const parsed = cartRecordSchema.safeParse(item.cart);

        if (!parsed.success) continue;
        const created = CartRecord.create(parsed.data);

        if (created.isOk() && created.value.isLive) {
          carts.push(created.value);
        }
      }

      return ok(carts);
    } catch (cause) {
      logger.error("Failed to list carts", { error: cause });

      return err(new RepoError.FailureFetching("Failed to list carts", { cause }));
    }
  }

  async findLatestSendByEmail(args: {
    access: BaseAccess;
    email: string;
  }): Promise<Result<string | null, InstanceType<typeof RepoError.FailureFetching>>> {
    /*
     * Cheap implementation: walk live carts. For higher-volume stores swap in
     * a GSI keyed by email — for one merchant this is fine.
     */
    const list = await this.listLiveCarts(args.access);

    if (list.isErr()) return err(list.error);

    let latest: string | null = null;

    for (const cart of list.value) {
      if (cart.email !== args.email) continue;
      for (const r of cart.remindersSent) {
        if (!latest || r.sentAt > latest) latest = r.sentAt;
      }
    }

    return ok(latest);
  }
}
