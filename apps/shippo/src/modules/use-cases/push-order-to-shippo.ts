import { err, ok, Result } from "neverthrow";

import { BaseError } from "@/lib/errors";
import { createLogger } from "@/lib/logger";
import { ShippoAppConfig } from "@/modules/app-config/domain/shippo-app-config";
import { AppConfigRepo } from "@/modules/app-config/repositories/app-config-repo";
import { SaleorApiUrl } from "@/modules/saleor/saleor-api-url";
import { SaleorGateway } from "@/modules/saleor/saleor-gateway";
import { ShippoClient } from "@/modules/shippo/shippo-client";

import { MetadataKeys } from "./metadata-keys";
import { OrderLinkStore } from "./order-link-store";
import { SyncTrackingToSaleorUseCase } from "./sync-tracking-to-saleor";

const logger = createLogger("PushOrderToShippo");

export const PushOrderError = {
  NotConfigured: BaseError.subclass("PushOrderNotConfiguredError", {
    props: { _internalName: "PushOrderError.NotConfigured" as const },
  }),
  UpstreamFailed: BaseError.subclass("PushOrderUpstreamFailedError", {
    props: { _internalName: "PushOrderError.UpstreamFailed" as const },
  }),
  MetadataUpdateFailed: BaseError.subclass("PushOrderMetadataUpdateFailedError", {
    props: { _internalName: "PushOrderError.MetadataUpdateFailed" as const },
  }),
};

export type PushOrderInput = {
  saleorApiUrl: SaleorApiUrl;
  appId: string;
  order: {
    id: string;
    number: string;
    createdAt: string;
    channelSlug: string;
    channelCurrency: string;
    email: string | null;
    total: number;
    currency: string;
    shippingMethodId: string | null;
    shippingMethodName: string | null;
    shippingAddress: {
      firstName: string | null;
      lastName: string | null;
      companyName: string | null;
      streetAddress1: string;
      streetAddress2: string | null;
      city: string;
      postalCode: string;
      countryArea: string | null;
      countryCode: string;
      phone: string | null;
    } | null;
    billingAddress: {
      firstName: string | null;
      lastName: string | null;
      companyName: string | null;
      streetAddress1: string;
      streetAddress2: string | null;
      city: string;
      postalCode: string;
      countryArea: string | null;
      countryCode: string;
      phone: string | null;
    } | null;
    lines: ReadonlyArray<{
      name: string;
      sku: string | null;
      quantity: number;
      unitPrice: number;
    }>;
  };
};

const buildExternalOrderId = (orderId: string, orderNumber: string) =>
  `saleor-${orderNumber}-${orderId.slice(-8)}`;

const SHIPPO_RATE_IN_ID = /shippo-([a-f0-9]+)/i;

const extractFromString = (s: string): string | null => {
  const match = s.match(SHIPPO_RATE_IN_ID);

  return match?.[1] ?? null;
};

/**
 * Saleor stores app shipping method ids as base64(`app:<app id or identifier>:shippo-<rateObjectId>`).
 * GraphQL exposes that string as `deliveryMethod.id`; we need the Shippo rate object_id for purchase.
 */
export const extractShippoRateObjectId = (saleorShippingMethodId: string | null | undefined) => {
  if (!saleorShippingMethodId) return null;

  const direct = extractFromString(saleorShippingMethodId);

  if (direct) {
    return direct;
  }

  try {
    const decoded = Buffer.from(saleorShippingMethodId, "base64").toString("utf8");
    const fromDecoded = extractFromString(decoded);

    if (fromDecoded) {
      return fromDecoded;
    }

    const parts = decoded.split(":");

    if (parts.length >= 3 && parts[0] === "app") {
      return extractFromString(parts.slice(2).join(":"));
    }
  } catch {
    // not valid base64
  }

  return null;
};

export class PushOrderToShippoUseCase {
  constructor(
    private readonly deps: {
      configRepo: AppConfigRepo;
      buildShippoClient: (config: ShippoAppConfig) => ShippoClient | null;
      buildSaleorGateway: (args: { saleorApiUrl: string; token: string }) => SaleorGateway;
      orderLinkStore: OrderLinkStore;
    },
  ) {}

  async execute(
    input: PushOrderInput,
    auth: { token: string; saleorApiUrl: string },
  ): Promise<
    Result<
      { externalOrderId: string; shippoTransactionId: string | null },
      | InstanceType<typeof PushOrderError.NotConfigured>
      | InstanceType<typeof PushOrderError.UpstreamFailed>
      | InstanceType<typeof PushOrderError.MetadataUpdateFailed>
    >
  > {
    const configResult = await this.deps.configRepo.getConfigByChannel({
      saleorApiUrl: input.saleorApiUrl,
      appId: input.appId,
      channelSlug: input.order.channelSlug,
    });

    if (configResult.isErr() || !configResult.value) {
      return err(
        new PushOrderError.NotConfigured(
          `No Shippo config for channel ${input.order.channelSlug}`,
        ),
      );
    }

    const config = configResult.value;
    const externalOrderId = buildExternalOrderId(input.order.id, input.order.number);

    const client = this.deps.buildShippoClient(config);

    if (!client) {
      return err(
        new PushOrderError.NotConfigured("Shippo API token is not configured for this channel"),
      );
    }

    const gateway = this.deps.buildSaleorGateway(auth);
    const rateObjectId = extractShippoRateObjectId(input.order.shippingMethodId);

    logger.info("Pushing order to Shippo", {
      orderId: input.order.id,
      channelSlug: input.order.channelSlug,
      autoPurchaseLabel: config.autoPurchaseLabel,
      shippingMethodId: input.order.shippingMethodId,
      rateObjectIdResolved: Boolean(rateObjectId),
    });

    if (!config.autoPurchaseLabel) {
      logger.info("autoPurchaseLabel disabled; writing linkage metadata only", {
        orderId: input.order.id,
        externalOrderId,
      });

      await this.deps.orderLinkStore.save({
        saleorApiUrl: input.saleorApiUrl,
        appId: input.appId,
        link: {
          saleorOrderId: input.order.id,
          externalOrderId,
          shippoTransactionId: "",
          channelSlug: input.order.channelSlug,
        },
      });

      const metaResult = await gateway.writePrivateMetadata(input.order.id, [
        { key: MetadataKeys.shippoExternalOrderId, value: externalOrderId },
        { key: MetadataKeys.shippoStatus, value: "pending_manual_label" },
        { key: MetadataKeys.shippoLastSyncAt, value: new Date().toISOString() },
      ]);

      if (metaResult.isErr()) {
        return err(
          new PushOrderError.MetadataUpdateFailed("Failed to write Shippo metadata", {
            cause: metaResult.error,
          }),
        );
      }

      return ok({ externalOrderId, shippoTransactionId: null });
    }

    if (!rateObjectId) {
      logger.warn("autoPurchaseLabel is on but order has no Shippo rate on delivery method", {
        orderId: input.order.id,
        shippingMethodId: input.order.shippingMethodId,
      });

      await this.deps.orderLinkStore.save({
        saleorApiUrl: input.saleorApiUrl,
        appId: input.appId,
        link: {
          saleorOrderId: input.order.id,
          externalOrderId,
          shippoTransactionId: "",
          channelSlug: input.order.channelSlug,
        },
      });

      const metaResult = await gateway.writePrivateMetadata(input.order.id, [
        { key: MetadataKeys.shippoExternalOrderId, value: externalOrderId },
        {
          key: MetadataKeys.shippoStatus,
          value: "skipped_no_shippo_rate",
        },
        { key: MetadataKeys.shippoLastSyncAt, value: new Date().toISOString() },
      ]);

      if (metaResult.isErr()) {
        return err(
          new PushOrderError.MetadataUpdateFailed("Failed to write Shippo metadata", {
            cause: metaResult.error,
          }),
        );
      }

      return ok({ externalOrderId, shippoTransactionId: null });
    }

    const purchase = await client.purchaseLabel({
      rateObjectId,
      labelFileType: config.labelFileType,
      metadata: externalOrderId,
    });

    if (purchase.isErr()) {
      return err(
        new PushOrderError.UpstreamFailed("Shippo label purchase failed", {
          cause: purchase.error,
        }),
      );
    }

    const { objectId, status, trackingNumber } = purchase.value;

    if (status !== "SUCCESS" && status !== "QUEUED") {
      logger.warn("Shippo transaction not successful", { status, objectId });

      return err(
        new PushOrderError.UpstreamFailed(`Shippo transaction status: ${status}`, {
          cause: new BaseError(JSON.stringify(purchase.value)),
        }),
      );
    }

    await this.deps.orderLinkStore.save({
      saleorApiUrl: input.saleorApiUrl,
      appId: input.appId,
      link: {
        saleorOrderId: input.order.id,
        externalOrderId,
        shippoTransactionId: objectId,
        channelSlug: input.order.channelSlug,
      },
    });

    const metaResult = await gateway.writePrivateMetadata(input.order.id, [
      { key: MetadataKeys.shippoExternalOrderId, value: externalOrderId },
      { key: MetadataKeys.shippoTransactionId, value: objectId },
      { key: MetadataKeys.shippoStatus, value: status.toLowerCase() },
      { key: MetadataKeys.shippoLastSyncAt, value: new Date().toISOString() },
    ]);

    if (metaResult.isErr()) {
      return err(
        new PushOrderError.MetadataUpdateFailed("Failed to write Shippo metadata", {
          cause: metaResult.error,
        }),
      );
    }

    if (trackingNumber) {
      const sync = new SyncTrackingToSaleorUseCase({
        buildSaleorGateway: this.deps.buildSaleorGateway,
      });
      const syncResult = await sync.execute(
        {
          saleorOrderId: input.order.id,
          trackingNumber,
          suppressSaleorEmails: config.emailsHandledBy === "shippo",
        },
        auth,
      );

      if (syncResult.isErr()) {
        logger.warn("Initial tracking sync after label purchase failed (webhook may retry)", {
          error: syncResult.error.message,
        });
      }
    }

    return ok({ externalOrderId, shippoTransactionId: objectId });
  }
}
