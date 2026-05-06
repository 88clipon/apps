import { err, ok, Result } from "neverthrow";

import { BaseError } from "@/lib/errors";
import { createLogger } from "@/lib/logger";
import { SaleorGateway } from "@/modules/saleor/saleor-gateway";

import { MetadataKeys } from "./metadata-keys";

const logger = createLogger("SyncTrackingToSaleor");

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
  saleorOrderId: string;
  trackingNumber: string;
  suppressSaleorEmails: boolean;
};

export class SyncTrackingToSaleorUseCase {
  constructor(
    private readonly deps: {
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
    if (!input.trackingNumber?.trim()) {
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

    const existingFulfillment = order.fulfillments?.find(
      (f: { status: string }) => f.status !== "cancelled" && f.status !== "CANCELED",
    ) as { id: string } | undefined;

    if (existingFulfillment) {
      const updateResult = await gateway.updateFulfillmentTracking({
        fulfillmentId: existingFulfillment.id,
        trackingNumber: input.trackingNumber,
        notifyCustomer: !input.suppressSaleorEmails,
      });

      if (updateResult.isErr()) {
        return err(
          new SyncTrackingError.FulfillmentFailed("updateTracking failed", {
            cause: updateResult.error,
          }),
        );
      }

      return ok({ fulfillmentId: existingFulfillment.id, trackingNumber: input.trackingNumber });
    }

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
      trackingNumber: input.trackingNumber,
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
      { key: MetadataKeys.shippoStatus, value: "fulfilled" },
      { key: MetadataKeys.shippoLastSyncAt, value: new Date().toISOString() },
    ]);

    return ok({ fulfillmentId: fulfillResult.value.fulfillmentId, trackingNumber: input.trackingNumber });
  }
}
