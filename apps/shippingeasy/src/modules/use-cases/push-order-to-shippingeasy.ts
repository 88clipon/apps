import { err, ok, Result } from "neverthrow";

import { BaseError } from "@/lib/errors";
import { createLogger } from "@/lib/logger";
import { ShippingEasyConfig } from "@/modules/app-config/domain/shippingeasy-config";
import { AppConfigRepo } from "@/modules/app-config/repositories/app-config-repo";
import { SaleorApiUrl } from "@/modules/saleor/saleor-api-url";
import { SaleorGateway, SaleorGatewayErrorInstance } from "@/modules/saleor/saleor-gateway";
import { ShippingEasyClient } from "@/modules/shippingeasy/shippingeasy-client";
import { ShippingEasyApiErrorInstance } from "@/modules/shippingeasy/shippingeasy-errors";

import { MetadataKeys } from "./metadata-keys";
import { OrderLinkStore } from "./order-link-store";

const logger = createLogger("PushOrderToShippingEasy");

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

export class PushOrderToShippingEasyUseCase {
  constructor(
    private readonly deps: {
      configRepo: AppConfigRepo;
      buildClient: (config: ShippingEasyConfig) => ShippingEasyClient;
      buildSaleorGateway: (args: { saleorApiUrl: string; token: string }) => SaleorGateway;
      orderLinkStore: OrderLinkStore;
    },
  ) {}

  async execute(
    input: PushOrderInput,
    auth: { token: string; saleorApiUrl: string },
  ): Promise<
    Result<
      { externalOrderId: string; shippingEasyOrderId: string },
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
          `No ShippingEasy config for channel ${input.order.channelSlug}`,
        ),
      );
    }

    const config = configResult.value;
    const client = this.deps.buildClient(config);

    if (!input.order.shippingAddress) {
      logger.info("Skipping order push - no shipping address", { orderId: input.order.id });

      return err(new PushOrderError.NotConfigured("Order has no shipping address"));
    }

    const shipToAddr = input.order.shippingAddress;

    const createResult = await client.createOrder({
      externalOrderIdentifier: buildExternalOrderId(input.order.id, input.order.number),
      orderedAt: input.order.createdAt,
      totalIncludingTax: input.order.total,
      currency: input.order.currency,
      sendEmails: config.emailsHandledBy === "shippingeasy",
      shippingAddress: {
        first_name: shipToAddr.firstName ?? "",
        last_name: shipToAddr.lastName ?? "",
        company: shipToAddr.companyName ?? "",
        street1: shipToAddr.streetAddress1,
        street2: shipToAddr.streetAddress2 ?? "",
        city: shipToAddr.city,
        state: shipToAddr.countryArea ?? "",
        postal_code: shipToAddr.postalCode,
        country: shipToAddr.countryCode,
        phone: shipToAddr.phone ?? "",
        email: input.order.email ?? "",
      },
      billingAddress: input.order.billingAddress
        ? {
            first_name: input.order.billingAddress.firstName ?? "",
            last_name: input.order.billingAddress.lastName ?? "",
            company: input.order.billingAddress.companyName ?? "",
            street1: input.order.billingAddress.streetAddress1,
            street2: input.order.billingAddress.streetAddress2 ?? "",
            city: input.order.billingAddress.city,
            state: input.order.billingAddress.countryArea ?? "",
            postal_code: input.order.billingAddress.postalCode,
            country: input.order.billingAddress.countryCode,
            phone: input.order.billingAddress.phone ?? "",
            email: input.order.email ?? "",
          }
        : undefined,
      items: input.order.lines.map((l) => ({
        name: l.name,
        sku: l.sku ?? undefined,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
      })),
    });

    if (createResult.isErr()) {
      return err(
        new PushOrderError.UpstreamFailed("ShippingEasy order create failed", {
          cause: createResult.error,
        }),
      );
    }

    const externalOrderId = buildExternalOrderId(input.order.id, input.order.number);
    const shippingEasyOrderId = createResult.value.order.id;

    logger.info("Pushed order to ShippingEasy", {
      orderId: input.order.id,
      externalOrderId,
      shippingEasyOrderId,
    });

    await this.deps.orderLinkStore.save({
      saleorApiUrl: input.saleorApiUrl,
      appId: input.appId,
      link: {
        saleorOrderId: input.order.id,
        externalOrderId,
        shippingEasyOrderId,
        channelSlug: input.order.channelSlug,
      },
    });

    const gateway = this.deps.buildSaleorGateway(auth);
    const metadataResult = await gateway.writePrivateMetadata(input.order.id, [
      { key: MetadataKeys.shippingEasyOrderId, value: shippingEasyOrderId },
      { key: MetadataKeys.shippingEasyExternalOrderId, value: externalOrderId },
      { key: MetadataKeys.shippingEasyStoreId, value: config.storeId },
      { key: MetadataKeys.shippingEasyStatus, value: "submitted" },
      { key: MetadataKeys.shippingEasyLastSyncAt, value: new Date().toISOString() },
    ]);

    if (metadataResult.isErr()) {
      return err(
        new PushOrderError.MetadataUpdateFailed("Failed to write ShippingEasy metadata", {
          cause: metadataResult.error,
        }),
      );
    }

    return ok({ externalOrderId, shippingEasyOrderId });
  }
}

const buildExternalOrderId = (orderId: string, orderNumber: string) =>
  `saleor-${orderNumber}-${orderId.slice(-8)}`;

 
const _unusedRefs = (
  _a: ShippingEasyApiErrorInstance,
  _b: SaleorGatewayErrorInstance,
) => null;
