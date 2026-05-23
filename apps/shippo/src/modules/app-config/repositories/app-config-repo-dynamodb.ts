import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { err, ok, Result } from "neverthrow";

import { createLogger } from "@/lib/logger";
import { AppRootConfig } from "@/modules/app-config/domain/app-root-config";
import {
  ShippingCategoryRule,
  shippingCategoryRuleSchema,
} from "@/modules/app-config/domain/shipping-category-rule";
import {
  ShippoAppConfig,
  shippoAppConfigSchema,
} from "@/modules/app-config/domain/shippo-app-config";
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
const CATEGORY_RULE_SK_PREFIX = "categoryRule#";

const toConfigSk = (configId: string) => `${CONFIG_SK_PREFIX}${configId}`;
const toChannelSk = (channelSlug: string) => `${CHANNEL_SK_PREFIX}${channelSlug}`;
const toCategoryRuleSk = (categorySlug: string) => `${CATEGORY_RULE_SK_PREFIX}${categorySlug}`;

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
    config: ShippoAppConfig;
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
              shippoApiToken: args.config.shippoApiToken,
              webhookSecret: args.config.webhookSecret,
              autoPurchaseLabel: args.config.autoPurchaseLabel,
              labelFileType: args.config.labelFileType,
              originAddress: args.config.originAddress,
              packageDefaults: args.config.packageDefaults,
              domesticServices: args.config.domesticServices,
              internationalServices: args.config.internationalServices,
              rateMarkup: args.config.rateMarkup,
              emailsHandledBy: args.config.emailsHandledBy,
              manufacturingLeadTimeDays: args.config.manufacturingLeadTimeDays,
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
  ): Promise<Result<ShippoAppConfig | null, InstanceType<typeof AppConfigRepoError.FailureFetching>>> {
    try {
      const result = await this.documentClient.send(
        new GetCommand({
          TableName: this.table.getName(),
          Key: { PK: this.pk(access), SK: toConfigSk(access.configId) },
        }),
      );

      if (!result.Item) return ok(null);
      const parsed = shippoAppConfigSchema.safeParse(result.Item.config);

      if (!parsed.success) {
        logger.warn("Stored config failed validation", { issues: parsed.error.issues });

        return ok(null);
      }
      const created = ShippoAppConfig.create(parsed.data);

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
  ): Promise<Result<ShippoAppConfig | null, InstanceType<typeof AppConfigRepoError.FailureFetching>>> {
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

      const configs = new Map<string, ShippoAppConfig>();
      const channelMapping = new Map<string, string>();
      const categoryRules = new Map<string, ShippingCategoryRule>();

      for (const item of items.Items ?? []) {
        const sk = item.SK as string;

        if (sk.startsWith(CONFIG_SK_PREFIX)) {
          const parsed = shippoAppConfigSchema.safeParse(item.config);

          if (!parsed.success) continue;
          const created = ShippoAppConfig.create(parsed.data);

          if (created.isOk()) {
            configs.set(created.value.id, created.value);
          }
        } else if (sk.startsWith(CHANNEL_SK_PREFIX)) {
          const slug = sk.slice(CHANNEL_SK_PREFIX.length);
          const configId = item.configId as string | undefined;

          if (configId) channelMapping.set(slug, configId);
        } else if (sk.startsWith(CATEGORY_RULE_SK_PREFIX)) {
          if (!item.rule) continue;
          const parsed = shippingCategoryRuleSchema.safeParse(item.rule);

          if (!parsed.success) {
            logger.warn("Stored category rule failed validation", {
              issues: parsed.error.issues,
              sk,
            });
            continue;
          }
          const created = ShippingCategoryRule.create(parsed.data);

          if (created.isOk()) {
            categoryRules.set(created.value.categorySlug, created.value);
          }
        }
      }

      return ok(new AppRootConfig(configs, channelMapping, categoryRules));
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

  async upsertCategoryRule(args: {
    rule: ShippingCategoryRule;
    saleorApiUrl: BaseAccess["saleorApiUrl"];
    appId: string;
  }): Promise<Result<void, InstanceType<typeof AppConfigRepoError.FailureSaving>>> {
    try {
      await this.documentClient.send(
        new PutCommand({
          TableName: this.table.getName(),
          Item: {
            PK: this.pk({ saleorApiUrl: args.saleorApiUrl, appId: args.appId }),
            SK: toCategoryRuleSk(args.rule.categorySlug),
            rule: args.rule.toJSON(),
          },
        }),
      );

      return ok(undefined);
    } catch (cause) {
      logger.error("Failed to save category rule", { error: cause });

      return err(
        new AppConfigRepoError.FailureSaving("Failed to save category rule", { cause }),
      );
    }
  }

  async removeCategoryRule(
    access: BaseAccess,
    data: { categorySlug: string },
  ): Promise<Result<void, InstanceType<typeof AppConfigRepoError.FailureRemoving>>> {
    try {
      await this.documentClient.send(
        new PutCommand({
          TableName: this.table.getName(),
          Item: {
            PK: this.pk(access),
            SK: toCategoryRuleSk(data.categorySlug),
            rule: null,
            deletedAt: new Date().toISOString(),
          },
        }),
      );

      return ok(undefined);
    } catch (cause) {
      logger.error("Failed to remove category rule", { error: cause });

      return err(
        new AppConfigRepoError.FailureRemoving("Failed to remove category rule", { cause }),
      );
    }
  }
}
