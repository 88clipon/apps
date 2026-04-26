import { err, ok, Result } from "neverthrow";

import { BaseError } from "@/lib/errors";
import { createLogger } from "@/lib/logger";
import { AppConfigRepo } from "@/modules/app-config/repositories/app-config-repo";
import { SaleorApiUrl } from "@/modules/saleor/saleor-api-url";
import { SaleorGateway } from "@/modules/saleor/saleor-gateway";
import { ShippingEasyWebhookEvent } from "@/modules/shippingeasy/shippingeasy-schemas";

import { MetadataKeys } from "./metadata-keys";

const logger = createLogger("SyncTrackingFromShippingEasy");

export const SyncTrackingError = {
  OrderNotFound: BaseError.subclass("SyncTrackingOrderNotFoundError", {
    props: { _internalName: "SyncTrackingError.OrderNotFound" as const },
  }),
  FulfillmentFailed: BaseError.subclass("SyncTrackingFulfillmentFailedError", {
    props: { _internalName: "SyncTrackingError.FulfillmentFailed" as const },
  }),
  AlreadyFulfilled: BaseError.subclass("SyncTrackingAlreadyFulfilledError", {
    props: { _internalName: "SyncTrackingError.AlreadyFulfilled" as const },
  }),
};

export type SyncTrackingInput = {
  saleorApiUrl: SaleorApiUrl;
  appId: string;
  event: ShippingEasyWebhookEvent;
  /**
   * Resolved from ShippingEasy's `external_order_identifier` which we set to
   * include the Saleor order id; see buildExternalOrderId in push-order.
   */
  saleorOrderId: string;
  /** If true, tell Saleor not to notify the customer (ShippingEasy is handling emails). */
  suppressSaleorEmails: boolean;
};

export class SyncTrackingFromShippingEasyUseCase {
  constructor(
    private readonly deps: {
      configRepo: AppConfigRepo;
      buildSaleorGateway: (args: { saleorApiUrl: string; token: string }) => SaleorGateway;
    },
  ) {}

  async execute(
    input: SyncTrackingInput,
    auth: { saleorApiUrl: string; token: string },
  ): Promise<
    Result<
      { fulfillmentId: string; trackingNumber: string },
      | InstanceType<typeof SyncTrackingError.OrderNotFound>
      | InstanceType<typeof SyncTrackingError.FulfillmentFailed>
      | InstanceType<typeof SyncTrackingError.AlreadyFulfilled>
    >
  > {
    const tracking =
      input.event.data?.shipment?.tracking_number ??
      input.event.data?.label?.tracking_number ??
      null;

    if (!tracking) {
      logger.warn("ShippingEasy event had no tracking number", { eventId: input.event.event_id });

      return err(new SyncTrackingError.FulfillmentFailed("Missing tracking number"));
    }

    const gateway = this.deps.buildSaleorGateway(auth);
    const orderResult = await gateway.fetchOrderForFulfillment(input.saleorOrderId);

    if (orderResult.isErr() || !orderResult.value) {
      return err(
        new SyncTrackingError.OrderNotFound(
          `Saleor order ${input.saleorOrderId} not found`,
          { cause: orderResult.isErr() ? orderResult.error : undefined },
        ),
      );
    }

    const order = orderResult.value;

    /**
     * If Saleor already has a fulfillment, just push the tracking number
     * instead of calling orderFulfill again. This is the common case for
     * `shipment.updated` and for re-deliveries of `label.created`.
     */
    const existingFulfillment = order.fulfillments?.find(
      (f: { status: string }) => f.status !== "cancelled" && f.status !== "CANCELED",
    ) as { id: string } | undefined;

    if (existingFulfillment) {
      const updateResult = await gateway.updateFulfillmentTracking({
        fulfillmentId: existingFulfillment.id,
        trackingNumber: tracking,
        notifyCustomer: !input.suppressSaleorEmails,
      });

      if (updateResult.isErr()) {
        return err(
          new SyncTrackingError.FulfillmentFailed("updateTracking failed", {
            cause: updateResult.error,
          }),
        );
      }

      return ok({ fulfillmentId: existingFulfillment.id, trackingNumber: tracking });
    }

    /**
     * Assume the full quantity ships in a single fulfillment drawn from the
     * first warehouse that stocks each variant. Stores that want split
     * fulfillments can do it manually in Saleor.
     */
    const linesWithWarehouse: Array<{
      orderLineId: string;
      quantity: number;
      warehouseId: string;
    }> = [];

    for (const line of order.lines ?? []) {
      const remaining = line.quantity - line.quantityFulfilled;

      if (remaining <= 0) continue;
      const warehouseId = line.variant?.stocks?.[0]?.warehouse?.id;

      if (!warehouseId) {
        logger.warn("No warehouse for line, skipping", { lineId: line.id });
        continue;
      }
      linesWithWarehouse.push({
        orderLineId: line.id,
        quantity: remaining,
        warehouseId,
      });
    }

    if (linesWithWarehouse.length === 0) {
      return err(new SyncTrackingError.AlreadyFulfilled("No fulfillable lines remain"));
    }

    const fulfillResult = await gateway.fulfillOrder({
      orderId: input.saleorOrderId,
      linesWithWarehouse,
      trackingNumber: tracking,
      notifyCustomer: !input.suppressSaleorEmails,
    });

    if (fulfillResult.isErr()) {
      return err(
        new SyncTrackingError.FulfillmentFailed("orderFulfill failed", {
          cause: fulfillResult.error,
        }),
      );
    }

    await gateway.writePrivateMetadata(input.saleorOrderId, [
      { key: MetadataKeys.shippingEasyStatus, value: "fulfilled" },
      { key: MetadataKeys.shippingEasyLastSyncAt, value: new Date().toISOString() },
    ]);

    return ok({ fulfillmentId: fulfillResult.value.fulfillmentId, trackingNumber: tracking });
  }
}
