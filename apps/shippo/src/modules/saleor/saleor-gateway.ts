import { err, ok, Result } from "neverthrow";
import { Client } from "urql";

import {
  OrderByIdForFulfillmentDocument,
  OrderFulfillDocument,
  OrderFulfillmentUpdateTrackingDocument,
  UpdateOrderPrivateMetadataDocument,
} from "@/generated/graphql";
import { BaseError } from "@/lib/errors";
import { createLogger } from "@/lib/logger";

const logger = createLogger("SaleorGateway");

export const SaleorGatewayError = {
  RequestFailed: BaseError.subclass("SaleorGatewayRequestFailedError", {
    props: { _internalName: "SaleorGatewayError.RequestFailed" as const },
  }),
  GraphQLError: BaseError.subclass("SaleorGatewayGraphQLError", {
    props: { _internalName: "SaleorGatewayError.GraphQLError" as const },
  }),
};

export type SaleorGatewayErrorInstance =
  | InstanceType<typeof SaleorGatewayError.RequestFailed>
  | InstanceType<typeof SaleorGatewayError.GraphQLError>;

/**
 * Thin wrapper around urql that returns Result<T, E> values for the subset of
 * Saleor mutations/queries this app cares about. Keeping this here (rather
 * than letting every use case call urql directly) makes tests / mocking
 * straightforward.
 */
export class SaleorGateway {
  constructor(private readonly client: Client) {}

  async fetchOrderForFulfillment(id: string) {
    const result = await this.client
      .query(OrderByIdForFulfillmentDocument, { id })
      .toPromise();

    if (result.error) {
      logger.warn("OrderById query failed", { error: result.error });

      return err(
        new SaleorGatewayError.RequestFailed("order query failed", { cause: result.error }),
      );
    }

    return ok(result.data?.order ?? null);
  }

  async fulfillOrder(args: {
    orderId: string;
    linesWithWarehouse: ReadonlyArray<{
      orderLineId: string;
      quantity: number;
      warehouseId: string;
    }>;
    trackingNumber: string;
    notifyCustomer: boolean;
  }): Promise<Result<{ fulfillmentId: string }, SaleorGatewayErrorInstance>> {
    const input = {
      notifyCustomer: args.notifyCustomer,
      trackingNumber: args.trackingNumber,
      lines: groupByLine(args.linesWithWarehouse).map((line) => ({
        orderLineId: line.orderLineId,
        stocks: [{ quantity: line.quantity, warehouse: line.warehouseId }],
      })),
    };

    const result = await this.client
      .mutation(OrderFulfillDocument, { order: args.orderId, input })
      .toPromise();

    if (result.error) {
      return err(
        new SaleorGatewayError.RequestFailed("orderFulfill mutation failed", {
          cause: result.error,
        }),
      );
    }
    const payload = result.data?.orderFulfill;

    if (!payload || (payload.errors ?? []).length > 0) {
      return err(
        new SaleorGatewayError.GraphQLError("orderFulfill returned errors", {
          cause: payload?.errors,
        }),
      );
    }
    const id = payload.fulfillments?.[0]?.id;

    if (!id) {
      return err(new SaleorGatewayError.GraphQLError("orderFulfill returned no fulfillment"));
    }

    return ok({ fulfillmentId: id });
  }

  async updateFulfillmentTracking(args: {
    fulfillmentId: string;
    trackingNumber: string;
    notifyCustomer: boolean;
  }): Promise<Result<void, SaleorGatewayErrorInstance>> {
    const result = await this.client
      .mutation(OrderFulfillmentUpdateTrackingDocument, {
        id: args.fulfillmentId,
        input: {
          trackingNumber: args.trackingNumber,
          notifyCustomer: args.notifyCustomer,
        },
      })
      .toPromise();

    if (result.error) {
      return err(
        new SaleorGatewayError.RequestFailed("updateTracking failed", { cause: result.error }),
      );
    }
    const payload = result.data?.orderFulfillmentUpdateTracking;

    if (!payload || (payload.errors ?? []).length > 0) {
      return err(
        new SaleorGatewayError.GraphQLError("updateTracking returned errors", {
          cause: payload?.errors,
        }),
      );
    }

    return ok(undefined);
  }

  async writePrivateMetadata(
    id: string,
    entries: ReadonlyArray<{ key: string; value: string }>,
  ): Promise<Result<void, SaleorGatewayErrorInstance>> {
    const result = await this.client
      .mutation(UpdateOrderPrivateMetadataDocument, { id, input: entries })
      .toPromise();

    if (result.error) {
      return err(
        new SaleorGatewayError.RequestFailed("updatePrivateMetadata failed", {
          cause: result.error,
        }),
      );
    }
    const payload = result.data?.updatePrivateMetadata;

    if (payload && (payload.errors ?? []).length > 0) {
      return err(
        new SaleorGatewayError.GraphQLError("updatePrivateMetadata returned errors", {
          cause: payload.errors,
        }),
      );
    }

    return ok(undefined);
  }
}

const groupByLine = (
  input: ReadonlyArray<{ orderLineId: string; quantity: number; warehouseId: string }>,
) => {
  const map = new Map<string, { orderLineId: string; quantity: number; warehouseId: string }>();

  for (const entry of input) {
    const key = `${entry.orderLineId}#${entry.warehouseId}`;
    const existing = map.get(key);

    if (existing) existing.quantity += entry.quantity;
    else map.set(key, { ...entry });
  }

  return Array.from(map.values());
};
