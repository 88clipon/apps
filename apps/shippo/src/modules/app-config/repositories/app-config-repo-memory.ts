import { ok, Result } from "neverthrow";

import { AppRootConfig } from "@/modules/app-config/domain/app-root-config";
import { ShippingCategoryRule } from "@/modules/app-config/domain/shipping-category-rule";
import { ShippoAppConfig } from "@/modules/app-config/domain/shippo-app-config";

import type {
  AppConfigRepo,
  AppConfigRepoError,
  BaseAccess,
  GetConfigByChannelAccess,
  GetConfigByIdAccess,
} from "./app-config-repo";

type InstallationKey = `${string}#${string}`;

type InstallationState = {
  configs: Map<string, ShippoAppConfig>;
  channelMapping: Map<string, string>;
  categoryRules: Map<string, ShippingCategoryRule>;
};

const keyOf = (a: BaseAccess): InstallationKey => `${a.saleorApiUrl}#${a.appId}`;

/**
 * Lightweight in-memory repository used for local development (APL=file) and
 * unit tests. In production the DynamoDB-backed implementation is used.
 */
export class AppConfigRepoMemory implements AppConfigRepo {
  private readonly state = new Map<InstallationKey, InstallationState>();

  private getOrCreate(access: BaseAccess): InstallationState {
    const k = keyOf(access);
    let existing = this.state.get(k);

    if (!existing) {
      existing = {
        configs: new Map(),
        channelMapping: new Map(),
        categoryRules: new Map(),
      };
      this.state.set(k, existing);
    }

    return existing;
  }

  async saveConfig(args: {
    config: ShippoAppConfig;
    saleorApiUrl: BaseAccess["saleorApiUrl"];
    appId: string;
  }): Promise<Result<void, InstanceType<typeof AppConfigRepoError.FailureSaving>>> {
    const state = this.getOrCreate({ saleorApiUrl: args.saleorApiUrl, appId: args.appId });

    state.configs.set(args.config.id, args.config);

    return ok(undefined);
  }

  async getConfigByChannel(
    access: GetConfigByChannelAccess,
  ): Promise<Result<ShippoAppConfig | null, InstanceType<typeof AppConfigRepoError.FailureFetching>>> {
    const state = this.getOrCreate(access);
    const configId = state.channelMapping.get(access.channelSlug);

    if (!configId) return ok(null);

    return ok(state.configs.get(configId) ?? null);
  }

  async getConfigById(
    access: GetConfigByIdAccess,
  ): Promise<Result<ShippoAppConfig | null, InstanceType<typeof AppConfigRepoError.FailureFetching>>> {
    const state = this.getOrCreate(access);

    return ok(state.configs.get(access.configId) ?? null);
  }

  async getRootConfig(
    access: BaseAccess,
  ): Promise<Result<AppRootConfig, InstanceType<typeof AppConfigRepoError.FailureFetching>>> {
    const state = this.getOrCreate(access);

    return ok(
      new AppRootConfig(
        new Map(state.configs),
        new Map(state.channelMapping),
        new Map(state.categoryRules),
      ),
    );
  }

  async removeConfig(
    access: BaseAccess,
    data: { configId: string },
  ): Promise<Result<void, InstanceType<typeof AppConfigRepoError.FailureRemoving>>> {
    const state = this.getOrCreate(access);

    state.configs.delete(data.configId);
    for (const [ch, cfg] of state.channelMapping.entries()) {
      if (cfg === data.configId) state.channelMapping.delete(ch);
    }

    return ok(undefined);
  }

  async updateChannelMapping(
    access: BaseAccess,
    data: { channelSlug: string; configId: string | null },
  ): Promise<Result<void, InstanceType<typeof AppConfigRepoError.FailureSaving>>> {
    const state = this.getOrCreate(access);

    if (data.configId === null) {
      state.channelMapping.delete(data.channelSlug);
    } else {
      state.channelMapping.set(data.channelSlug, data.configId);
    }

    return ok(undefined);
  }

  async upsertCategoryRule(args: {
    rule: ShippingCategoryRule;
    saleorApiUrl: BaseAccess["saleorApiUrl"];
    appId: string;
  }): Promise<Result<void, InstanceType<typeof AppConfigRepoError.FailureSaving>>> {
    const state = this.getOrCreate({
      saleorApiUrl: args.saleorApiUrl,
      appId: args.appId,
    });

    state.categoryRules.set(args.rule.categorySlug, args.rule);

    return ok(undefined);
  }

  async removeCategoryRule(
    access: BaseAccess,
    data: { categorySlug: string },
  ): Promise<Result<void, InstanceType<typeof AppConfigRepoError.FailureRemoving>>> {
    const state = this.getOrCreate(access);

    state.categoryRules.delete(data.categorySlug);

    return ok(undefined);
  }
}
