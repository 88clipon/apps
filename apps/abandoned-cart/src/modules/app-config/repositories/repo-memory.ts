import { ok, Result } from "neverthrow";

import { AppConfig } from "@/modules/app-config/domain/app-config";
import { CartRecord } from "@/modules/app-config/domain/cart-record";

import { AbandonedCartRepo, BaseAccess, RepoError } from "./repo";

const keyFor = (access: BaseAccess) => `${access.saleorApiUrl}#${access.appId}`;

/** In-memory repo used in unit tests and when APL=file in local dev. */
export class AbandonedCartRepoMemory implements AbandonedCartRepo {
  private configs = new Map<string, AppConfig>();
  private carts = new Map<string, Map<string, CartRecord>>();

  async getConfig(
    access: BaseAccess,
  ): Promise<Result<AppConfig | null, InstanceType<typeof RepoError.FailureFetching>>> {
    return ok(this.configs.get(keyFor(access)) ?? null);
  }

  async saveConfig(args: {
    access: BaseAccess;
    config: AppConfig;
  }): Promise<Result<void, InstanceType<typeof RepoError.FailureSaving>>> {
    this.configs.set(keyFor(args.access), args.config);

    return ok(undefined);
  }

  async getCart(args: {
    access: BaseAccess;
    checkoutId: string;
  }): Promise<Result<CartRecord | null, InstanceType<typeof RepoError.FailureFetching>>> {
    const tenant = this.carts.get(keyFor(args.access));

    return ok(tenant?.get(args.checkoutId) ?? null);
  }

  async saveCart(args: {
    access: BaseAccess;
    cart: CartRecord;
  }): Promise<Result<void, InstanceType<typeof RepoError.FailureSaving>>> {
    const key = keyFor(args.access);
    const tenant = this.carts.get(key) ?? new Map<string, CartRecord>();

    tenant.set(args.cart.checkoutId, args.cart);
    this.carts.set(key, tenant);

    return ok(undefined);
  }

  async listLiveCarts(
    access: BaseAccess,
  ): Promise<Result<CartRecord[], InstanceType<typeof RepoError.FailureFetching>>> {
    const tenant = this.carts.get(keyFor(access));

    if (!tenant) return ok([]);

    return ok(Array.from(tenant.values()).filter((c) => c.isLive));
  }

  async findLatestSendByEmail(args: {
    access: BaseAccess;
    email: string;
  }): Promise<Result<string | null, InstanceType<typeof RepoError.FailureFetching>>> {
    const tenant = this.carts.get(keyFor(args.access));

    if (!tenant) return ok(null);

    let latest: string | null = null;

    for (const cart of tenant.values()) {
      if (cart.email !== args.email) continue;
      for (const r of cart.remindersSent) {
        if (!latest || r.sentAt > latest) latest = r.sentAt;
      }
    }

    return ok(latest);
  }
}
