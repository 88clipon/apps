import { Result } from "neverthrow";

import { BaseError } from "@/lib/errors";
import { AppRootConfig } from "@/modules/app-config/domain/app-root-config";
import { ShippingCategoryRule } from "@/modules/app-config/domain/shipping-category-rule";
import { ShippoAppConfig } from "@/modules/app-config/domain/shippo-app-config";
import { SaleorApiUrl } from "@/modules/saleor/saleor-api-url";

export type BaseAccess = {
  saleorApiUrl: SaleorApiUrl;
  appId: string;
};

export type GetConfigByChannelAccess = BaseAccess & { channelSlug: string };
export type GetConfigByIdAccess = BaseAccess & { configId: string };

export const AppConfigRepoError = {
  FailureSaving: BaseError.subclass("AppConfigRepoFailureSavingError", {
    props: { _internalName: "AppConfigRepoError.FailureSaving" as const },
  }),
  FailureFetching: BaseError.subclass("AppConfigRepoFailureFetchingError", {
    props: { _internalName: "AppConfigRepoError.FailureFetching" as const },
  }),
  FailureRemoving: BaseError.subclass("AppConfigRepoFailureRemovingError", {
    props: { _internalName: "AppConfigRepoError.FailureRemoving" as const },
  }),
};

export interface AppConfigRepo {
  saveConfig(args: {
    config: ShippoAppConfig;
    saleorApiUrl: SaleorApiUrl;
    appId: string;
  }): Promise<Result<void, InstanceType<typeof AppConfigRepoError.FailureSaving>>>;

  getConfigByChannel(
    access: GetConfigByChannelAccess,
  ): Promise<
    Result<ShippoAppConfig | null, InstanceType<typeof AppConfigRepoError.FailureFetching>>
  >;

  getConfigById(
    access: GetConfigByIdAccess,
  ): Promise<
    Result<ShippoAppConfig | null, InstanceType<typeof AppConfigRepoError.FailureFetching>>
  >;

  getRootConfig(
    access: BaseAccess,
  ): Promise<Result<AppRootConfig, InstanceType<typeof AppConfigRepoError.FailureFetching>>>;

  removeConfig(
    access: BaseAccess,
    data: { configId: string },
  ): Promise<Result<void, InstanceType<typeof AppConfigRepoError.FailureRemoving>>>;

  updateChannelMapping(
    access: BaseAccess,
    data: { channelSlug: string; configId: string | null },
  ): Promise<Result<void, InstanceType<typeof AppConfigRepoError.FailureSaving>>>;

  upsertCategoryRule(args: {
    rule: ShippingCategoryRule;
    saleorApiUrl: SaleorApiUrl;
    appId: string;
  }): Promise<Result<void, InstanceType<typeof AppConfigRepoError.FailureSaving>>>;

  removeCategoryRule(
    access: BaseAccess,
    data: { categorySlug: string },
  ): Promise<Result<void, InstanceType<typeof AppConfigRepoError.FailureRemoving>>>;
}
