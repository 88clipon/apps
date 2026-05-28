import { Result } from "neverthrow";

import { BaseError } from "@/lib/errors";
import { AppConfig } from "@/modules/app-config/domain/app-config";
import { CartRecord } from "@/modules/app-config/domain/cart-record";
import { SaleorApiUrl } from "@/modules/saleor/saleor-api-url";

export type BaseAccess = {
  saleorApiUrl: SaleorApiUrl;
  appId: string;
};

export const RepoError = {
  FailureFetching: BaseError.subclass("RepoFailureFetchingError"),
  FailureSaving: BaseError.subclass("RepoFailureSavingError"),
  FailureRemoving: BaseError.subclass("RepoFailureRemovingError"),
};

/**
 * Single source of truth for all abandoned-cart persistence. Implementations:
 *   - DynamoDB (prod) — uses the shared DynamoMainTable with row prefixes:
 *       SK `config`                                — singleton app config
 *       SK `cart#<checkoutId>`                     — one per tracked checkout
 *   - In-memory (tests / local dev with APL=file).
 */
export interface AbandonedCartRepo {
  // ---- app config ----
  getConfig(
    access: BaseAccess,
  ): Promise<Result<AppConfig | null, InstanceType<typeof RepoError.FailureFetching>>>;
  saveConfig(args: {
    access: BaseAccess;
    config: AppConfig;
  }): Promise<Result<void, InstanceType<typeof RepoError.FailureSaving>>>;

  // ---- cart records ----
  getCart(args: {
    access: BaseAccess;
    checkoutId: string;
  }): Promise<Result<CartRecord | null, InstanceType<typeof RepoError.FailureFetching>>>;
  saveCart(args: {
    access: BaseAccess;
    cart: CartRecord;
  }): Promise<Result<void, InstanceType<typeof RepoError.FailureSaving>>>;
  /**
   * Returns live (unrecovered, not unsubscribed, has email) carts whose last
   * activity is older than the cutoff. Scheduler uses this to find work.
   */
  listLiveCarts(
    args: BaseAccess,
  ): Promise<Result<CartRecord[], InstanceType<typeof RepoError.FailureFetching>>>;
  /** Returns the existing live cart for a given email, if any. For throttling. */
  findLatestSendByEmail(args: {
    access: BaseAccess;
    email: string;
  }): Promise<Result<string | null, InstanceType<typeof RepoError.FailureFetching>>>;
}
