import { err, ok, Result } from "neverthrow";

import { BaseError } from "@/lib/errors";
import { createLogger } from "@/lib/logger";
import { ShippoAppConfig } from "@/modules/app-config/domain/shippo-app-config";
import { AppConfigRepo } from "@/modules/app-config/repositories/app-config-repo";
import { SaleorApiUrl } from "@/modules/saleor/saleor-api-url";
import { SaleorGateway } from "@/modules/saleor/saleor-gateway";
import { ShippoClient } from "@/modules/shippo/shippo-client";

import { MetadataKeys, type MetadataKeyValue } from "./metadata-keys";
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
    /** Sum of line totals (gross) before shipping/tax. */
    subtotal: number;
    /** Total tax amount (gross - net or explicit). */
    tax: number;
    shippingCost: number;
    currency: string;
    /** Total parcel weight in ounces. Falls back to a sensible default if 0. */
    totalWeightOunces: number;
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
      totalPrice: number;
      /** Per-unit weight in ounces if known. */
      unitWeightOunces: number | null;
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
      { externalOrderId: string; shippoOrderId: string | null; shippoTransactionId: string | null },
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

    if (!input.order.shippingAddress) {
      logger.warn("Order has no shipping address; cannot create Shippo order", {
        orderId: input.order.id,
      });

      await this.deps.orderLinkStore.save({
        saleorApiUrl: input.saleorApiUrl,
        appId: input.appId,
        link: {
          saleorOrderId: input.order.id,
          externalOrderId,
          shippoOrderId: "",
          shippoTransactionId: "",
          channelSlug: input.order.channelSlug,
        },
      });

      const metaResult = await gateway.writePrivateMetadata(input.order.id, [
        { key: MetadataKeys.shippoExternalOrderId, value: externalOrderId },
        { key: MetadataKeys.shippoStatus, value: "skipped_no_shipping_address" },
        { key: MetadataKeys.shippoLastSyncAt, value: new Date().toISOString() },
      ]);

      if (metaResult.isErr()) {
        return err(
          new PushOrderError.MetadataUpdateFailed("Failed to write Shippo metadata", {
            cause: metaResult.error,
          }),
        );
      }

      return ok({ externalOrderId, shippoOrderId: null, shippoTransactionId: null });
    }

    /*
     * Always push the order to Shippo's Orders page first so merchants can
     * see and manage every order in Shippo regardless of label-buying mode.
     */
    const orderResult = await client.createOrder({
      orderNumber: input.order.number,
      externalOrderId,
      placedAt: input.order.createdAt,
      orderStatus: "PAID",
      email: input.order.email,
      toAddress: {
        name: [input.order.shippingAddress.firstName, input.order.shippingAddress.lastName]
          .filter(Boolean)
          .join(" "),
        company: input.order.shippingAddress.companyName,
        street1: input.order.shippingAddress.streetAddress1,
        street2: input.order.shippingAddress.streetAddress2,
        city: input.order.shippingAddress.city,
        state: input.order.shippingAddress.countryArea,
        zip: input.order.shippingAddress.postalCode,
        country: input.order.shippingAddress.countryCode,
        phone: input.order.shippingAddress.phone,
        email: input.order.email,
      },
      fromAddress: {
        name: config.originAddress.name,
        company: config.originAddress.company,
        street1: config.originAddress.street1,
        street2: config.originAddress.street2,
        city: config.originAddress.city,
        state: config.originAddress.state,
        zip: config.originAddress.postalCode,
        country: config.originAddress.country,
        phone: config.originAddress.phone,
        email: config.originAddress.email,
      },
      lineItems: input.order.lines.map((l) => ({
        title: l.name,
        sku: l.sku,
        quantity: l.quantity,
        totalPrice: l.totalPrice,
        currency: input.order.currency,
        weightOunces: l.unitWeightOunces,
      })),
      totals: {
        subtotal: input.order.subtotal,
        tax: input.order.tax,
        shippingCost: input.order.shippingCost,
        total: input.order.total,
        currency: input.order.currency,
      },
      weightOunces: input.order.totalWeightOunces,
      shippingMethodName: input.order.shippingMethodName,
      notes: `Saleor order ${input.order.number} (${externalOrderId})`,
    });

    let shippoOrderId: string | null = null;

    if (orderResult.isErr()) {
      logger.warn("Shippo create order failed; continuing with label flow", {
        orderId: input.order.id,
        error: orderResult.error.message,
      });
    } else {
      shippoOrderId = orderResult.value.objectId;
      logger.info("Shippo order created", {
        orderId: input.order.id,
        shippoOrderId,
        status: orderResult.value.status,
      });
    }

    if (!config.autoPurchaseLabel) {
      logger.info("autoPurchaseLabel disabled; recording linkage and stopping after order push", {
        orderId: input.order.id,
        externalOrderId,
        shippoOrderId,
      });

      await this.deps.orderLinkStore.save({
        saleorApiUrl: input.saleorApiUrl,
        appId: input.appId,
        link: {
          saleorOrderId: input.order.id,
          externalOrderId,
          shippoOrderId: shippoOrderId ?? "",
          shippoTransactionId: "",
          channelSlug: input.order.channelSlug,
        },
      });

      const metaEntries: Array<{ key: MetadataKeyValue; value: string }> = [
        { key: MetadataKeys.shippoExternalOrderId, value: externalOrderId },
        { key: MetadataKeys.shippoStatus, value: shippoOrderId ? "pushed_to_shippo" : "push_failed" },
        { key: MetadataKeys.shippoLastSyncAt, value: new Date().toISOString() },
      ];

      if (shippoOrderId) {
        metaEntries.push({ key: MetadataKeys.shippoOrderId, value: shippoOrderId });
      }

      const metaResult = await gateway.writePrivateMetadata(input.order.id, metaEntries);

      if (metaResult.isErr()) {
        return err(
          new PushOrderError.MetadataUpdateFailed("Failed to write Shippo metadata", {
            cause: metaResult.error,
          }),
        );
      }

      if (!shippoOrderId) {
        return err(
          new PushOrderError.UpstreamFailed("Shippo create order failed", {
            cause: orderResult.isErr() ? orderResult.error : new BaseError("unknown"),
          }),
        );
      }

      return ok({ externalOrderId, shippoOrderId, shippoTransactionId: null });
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
          shippoOrderId: shippoOrderId ?? "",
          shippoTransactionId: "",
          channelSlug: input.order.channelSlug,
        },
      });

      const metaEntries: Array<{ key: MetadataKeyValue; value: string }> = [
        { key: MetadataKeys.shippoExternalOrderId, value: externalOrderId },
        { key: MetadataKeys.shippoStatus, value: "skipped_no_shippo_rate" },
        { key: MetadataKeys.shippoLastSyncAt, value: new Date().toISOString() },
      ];

      if (shippoOrderId) {
        metaEntries.push({ key: MetadataKeys.shippoOrderId, value: shippoOrderId });
      }

      const metaResult = await gateway.writePrivateMetadata(input.order.id, metaEntries);

      if (metaResult.isErr()) {
        return err(
          new PushOrderError.MetadataUpdateFailed("Failed to write Shippo metadata", {
            cause: metaResult.error,
          }),
        );
      }

      return ok({ externalOrderId, shippoOrderId, shippoTransactionId: null });
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
        shippoOrderId: shippoOrderId ?? "",
        shippoTransactionId: objectId,
        channelSlug: input.order.channelSlug,
      },
    });

    const metaEntries: Array<{ key: MetadataKeyValue; value: string }> = [
      { key: MetadataKeys.shippoExternalOrderId, value: externalOrderId },
      { key: MetadataKeys.shippoTransactionId, value: objectId },
      { key: MetadataKeys.shippoStatus, value: status.toLowerCase() },
      { key: MetadataKeys.shippoLastSyncAt, value: new Date().toISOString() },
    ];

    if (shippoOrderId) {
      metaEntries.push({ key: MetadataKeys.shippoOrderId, value: shippoOrderId });
    }

    const metaResult = await gateway.writePrivateMetadata(input.order.id, metaEntries);

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

    return ok({ externalOrderId, shippoOrderId, shippoTransactionId: objectId });
  }
}
