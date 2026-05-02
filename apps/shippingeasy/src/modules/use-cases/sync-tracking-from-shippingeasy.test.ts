import { err, ok } from "neverthrow";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createSaleorApiUrl } from "@/modules/saleor/saleor-api-url";

import { AppConfigRepo } from "../app-config/repositories/app-config-repo";
import { ShippingEasyWebhookEvent } from "../shippingeasy/shippingeasy-schemas";
import { SyncTrackingFromShippingEasyUseCase } from "./sync-tracking-from-shippingeasy";

const saleorApiUrl = createSaleorApiUrl("https://example.saleor.cloud/graphql/")._unsafeUnwrap();

type TestOrder = {
  id: string;
  fulfillments: Array<{ id: string; status: string }>;
  lines: Array<{
    id: string;
    quantity: number;
    quantityFulfilled: number;
    variant: {
      stocks: Array<{ warehouse: { id: string } }>;
    };
  }>;
};

const baseOrder: TestOrder = {
  id: "T3JkZXI6MQ==",
  fulfillments: [],
  lines: [
    {
      id: "line-1",
      quantity: 1,
      quantityFulfilled: 0,
      variant: {
        stocks: [{ warehouse: { id: "warehouse-1" } }],
      },
    },
  ],
};

const buildEvent = (overrides: Partial<ShippingEasyWebhookEvent> = {}): ShippingEasyWebhookEvent => ({
  event: "label.created",
  event_id: "evt_1",
  data: {
    external_order_identifier: "saleor-1000-abc12345",
    shipment: { tracking_number: "TRK123" },
  },
  ...overrides,
});

const buildGateway = () => ({
  fetchOrderForFulfillment: vi.fn(async () => ok<TestOrder | null, never>(baseOrder)),
  fulfillOrder: vi.fn(async () => ok({ fulfillmentId: "Ful:1" })),
  updateFulfillmentTracking: vi.fn(async () => ok({ fulfillmentId: "Ful:1" })),
  writePrivateMetadata: vi.fn(async () => ok(undefined)),
});

const buildConfigRepo = (): AppConfigRepo => ({} as AppConfigRepo);

describe("SyncTrackingFromShippingEasyUseCase", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls orderFulfill with notifyCustomer=false when ShippingEasy owns emails", async () => {
    const gw = buildGateway();
    const useCase = new SyncTrackingFromShippingEasyUseCase({
      configRepo: buildConfigRepo(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      buildSaleorGateway: () => gw as any,
    });

    const result = await useCase.execute(
      {
        saleorApiUrl,
        appId: "app-1",
        event: buildEvent(),
        saleorOrderId: baseOrder.id,
        suppressSaleorEmails: true,
      },
      { saleorApiUrl, token: "t" },
    );

    expect(result.isOk()).toBe(true);
    expect(gw.fulfillOrder).toHaveBeenCalledWith(
      expect.objectContaining({ notifyCustomer: false, trackingNumber: "TRK123" }),
    );
  });

  it("calls orderFulfill with notifyCustomer=true when Saleor owns emails", async () => {
    const gw = buildGateway();
    const useCase = new SyncTrackingFromShippingEasyUseCase({
      configRepo: buildConfigRepo(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      buildSaleorGateway: () => gw as any,
    });

    const result = await useCase.execute(
      {
        saleorApiUrl,
        appId: "app-1",
        event: buildEvent(),
        saleorOrderId: baseOrder.id,
        suppressSaleorEmails: false,
      },
      { saleorApiUrl, token: "t" },
    );

    expect(result.isOk()).toBe(true);
    expect(gw.fulfillOrder).toHaveBeenCalledWith(
      expect.objectContaining({ notifyCustomer: true }),
    );
  });

  it("updates tracking on an existing fulfillment instead of creating a new one", async () => {
    const gw = buildGateway();

    gw.fetchOrderForFulfillment.mockResolvedValueOnce(
      ok<TestOrder | null, never>({
        ...baseOrder,
        fulfillments: [{ id: "Ful:existing", status: "fulfilled" }],
      }),
    );
    const useCase = new SyncTrackingFromShippingEasyUseCase({
      configRepo: buildConfigRepo(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      buildSaleorGateway: () => gw as any,
    });

    const result = await useCase.execute(
      {
        saleorApiUrl,
        appId: "app-1",
        event: buildEvent({ event: "shipment.updated" }),
        saleorOrderId: baseOrder.id,
        suppressSaleorEmails: true,
      },
      { saleorApiUrl, token: "t" },
    );

    expect(result.isOk()).toBe(true);
    expect(gw.updateFulfillmentTracking).toHaveBeenCalledWith({
      fulfillmentId: "Ful:existing",
      trackingNumber: "TRK123",
      notifyCustomer: false,
    });
    expect(gw.fulfillOrder).not.toHaveBeenCalled();
  });

  it("returns OrderNotFound when Saleor cannot locate the order", async () => {
    const gw = buildGateway();

    gw.fetchOrderForFulfillment.mockResolvedValueOnce(ok<TestOrder | null, never>(null));
    const useCase = new SyncTrackingFromShippingEasyUseCase({
      configRepo: buildConfigRepo(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      buildSaleorGateway: () => gw as any,
    });

    const result = await useCase.execute(
      {
        saleorApiUrl,
        appId: "app-1",
        event: buildEvent(),
        saleorOrderId: "missing",
        suppressSaleorEmails: true,
      },
      { saleorApiUrl, token: "t" },
    );

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error._internalName).toBe("SyncTrackingError.OrderNotFound");
    }
  });

  it("bails out when there is no tracking number", async () => {
    const gw = buildGateway();
    const useCase = new SyncTrackingFromShippingEasyUseCase({
      configRepo: buildConfigRepo(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      buildSaleorGateway: () => gw as any,
    });

    const result = await useCase.execute(
      {
        saleorApiUrl,
        appId: "app-1",
        event: buildEvent({ data: { external_order_identifier: "x" } }),
        saleorOrderId: baseOrder.id,
        suppressSaleorEmails: true,
      },
      { saleorApiUrl, token: "t" },
    );

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error._internalName).toBe("SyncTrackingError.FulfillmentFailed");
    }
  });
});

// reference imports so unused module checker doesn't complain
export type _ = typeof err;
