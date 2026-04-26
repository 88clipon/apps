import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { err, ok, Result } from "neverthrow";

import { createLogger } from "@/lib/logger";
import { AppRootConfig } from "@/modules/app-config/domain/app-root-config";
import {
  ShippingEasyConfig,
  shippingEasyConfigSchema,
} from "@/modules/app-config/domain/shippingeasy-config";
import { DynamoMainTable } from "@/modules/dynamodb/dynamo-main-table";

import {
  AppConfigRepo,
  AppConfigRepoError,
  BaseAccess,
  GetConfigByChannelAccess,
  GetConfigByIdAccess,
} from "./app-config-repo";

const logger = createLogger("AppConfigRepoDynamoDB");

const CONFIG_SK_PREFIX = "config#";
const CHANNEL_SK_PREFIX = "channel#";

const toConfigSk = (configId: string) => `${CONFIG_SK_PREFIX}${configId}`;
const toChannelSk = (channelSlug: string) => `${CHANNEL_SK_PREFIX}${channelSlug}`;

/**
 * DynamoDB-backed AppConfigRepo. Uses the same PK/SK layout as the Stripe app
 * so it can share the `DynamoMainTable`.
 */
export class AppConfigRepoDynamoDB implements AppConfigRepo {
  constructor(
    private readonly table: DynamoMainTable,
    private readonly documentClient: DynamoDBDocumentClient,
  ) {}

  private pk(access: BaseAccess): string {
    return DynamoMainTable.getPrimaryKeyScopedToInstallation(access);
  }

  async saveConfig(args: {
    config: ShippingEasyConfig;
    saleorApiUrl: BaseAccess["saleorApiUrl"];
    appId: string;
  }): Promise<Result<void, InstanceType<typeof AppConfigRepoError.FailureSaving>>> {
    try {
      await this.documentClient.send(
        new PutCommand({
          TableName: this.table.getName(),
          Item: {
            PK: this.pk({ saleorApiUrl: args.saleorApiUrl, appId: args.appId }),
            SK: toConfigSk(args.config.id),
            config: {
              id: args.config.id,
              name: args.config.name,
              apiKey: args.config.apiKey,
              apiSecret: args.config.apiSecret,
              storeId: args.config.storeId,
              webhookSecret: args.config.webhookSecret,
              originAddress: args.config.originAddress,
              packageDefaults: args.config.packageDefaults,
              enabledCarriers: args.config.enabledCarriers,
              rateMarkup: args.config.rateMarkup,
              emailsHandledBy: args.config.emailsHandledBy,
            },
          },
        }),
      );

      return ok(undefined);
    } catch (cause) {
      logger.error("Failed to save config", { error: cause });

      return err(new AppConfigRepoError.FailureSaving("Failed to save config", { cause }));
    }
  }

  async getConfigById(
    access: GetConfigByIdAccess,
  ): Promise<Result<ShippingEasyConfig | null, InstanceType<typeof AppConfigRepoError.FailureFetching>>> {
    try {
      const result = await this.documentClient.send(
        new GetCommand({
          TableName: this.table.getName(),
          Key: { PK: this.pk(access), SK: toConfigSk(access.configId) },
        }),
      );

      if (!result.Item) return ok(null);
      const parsed = shippingEasyConfigSchema.safeParse(result.Item.config);

      if (!parsed.success) {
        logger.warn("Stored config failed validation", { issues: parsed.error.issues });

        return ok(null);
      }
      const created = ShippingEasyConfig.create(parsed.data);

      if (created.isErr()) {
        return err(
          new AppConfigRepoError.FailureFetching("Invalid stored config", { cause: created.error }),
        );
      }

      return ok(created.value);
    } catch (cause) {
      logger.error("Failed to fetch config", { error: cause });

      return err(new AppConfigRepoError.FailureFetching("Failed to fetch config", { cause }));
    }
  }

  async getConfigByChannel(
    access: GetConfigByChannelAccess,
  ): Promise<Result<ShippingEasyConfig | null, InstanceType<typeof AppConfigRepoError.FailureFetching>>> {
    try {
      const mapping = await this.documentClient.send(
        new GetCommand({
          TableName: this.table.getName(),
          Key: { PK: this.pk(access), SK: toChannelSk(access.channelSlug) },
        }),
      );
      const configId = mapping.Item?.configId as string | undefined;

      if (!configId) return ok(null);

      return this.getConfigById({ ...access, configId });
    } catch (cause) {
      logger.error("Failed to fetch config by channel", { error: cause });

      return err(new AppConfigRepoError.FailureFetching("Failed to fetch config by channel", { cause }));
    }
  }

  async getRootConfig(
    access: BaseAccess,
  ): Promise<Result<AppRootConfig, InstanceType<typeof AppConfigRepoError.FailureFetching>>> {
    try {
      const items = await this.documentClient.send(
        new QueryCommand({
          TableName: this.table.getName(),
          KeyConditionExpression: "#pk = :pk",
          ExpressionAttributeNames: { "#pk": "PK" },
          ExpressionAttributeValues: { ":pk": this.pk(access) },
        }),
      );

      const configs = new Map<string, ShippingEasyConfig>();
      const channelMapping = new Map<string, string>();

      for (const item of items.Items ?? []) {
        const sk = item.SK as string;

        if (sk.startsWith(CONFIG_SK_PREFIX)) {
          const parsed = shippingEasyConfigSchema.safeParse(item.config);

          if (!parsed.success) continue;
          const created = ShippingEasyConfig.create(parsed.data);

          if (created.isOk()) {
            configs.set(created.value.id, created.value);
          }
        } else if (sk.startsWith(CHANNEL_SK_PREFIX)) {
          const slug = sk.slice(CHANNEL_SK_PREFIX.length);
          const configId = item.configId as string | undefined;

          if (configId) channelMapping.set(slug, configId);
        }
      }

      return ok(new AppRootConfig(configs, channelMapping));
    } catch (cause) {
      logger.error("Failed to fetch root config", { error: cause });

      return err(new AppConfigRepoError.FailureFetching("Failed to fetch root config", { cause }));
    }
  }

  async removeConfig(
    access: BaseAccess,
    data: { configId: string },
  ): Promise<Result<void, InstanceType<typeof AppConfigRepoError.FailureRemoving>>> {
    try {
      await this.documentClient.send(
        new PutCommand({
          TableName: this.table.getName(),
          Item: {
            PK: this.pk(access),
            SK: toConfigSk(data.configId),
            config: null,
            deletedAt: new Date().toISOString(),
          },
        }),
      );

      return ok(undefined);
    } catch (cause) {
      logger.error("Failed to remove config", { error: cause });

      return err(new AppConfigRepoError.FailureRemoving("Failed to remove config", { cause }));
    }
  }

  async updateChannelMapping(
    access: BaseAccess,
    data: { channelSlug: string; configId: string | null },
  ): Promise<Result<void, InstanceType<typeof AppConfigRepoError.FailureSaving>>> {
    try {
      await this.documentClient.send(
        new PutCommand({
          TableName: this.table.getName(),
          Item: {
            PK: this.pk(access),
            SK: toChannelSk(data.channelSlug),
            configId: data.configId,
          },
        }),
      );

      return ok(undefined);
    } catch (cause) {
      logger.error("Failed to update channel mapping", { error: cause });

      return err(
        new AppConfigRepoError.FailureSaving("Failed to update channel mapping", { cause }),
      );
    }
  }
}
