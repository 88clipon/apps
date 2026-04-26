import { err, ok, Result } from "neverthrow";

import { BaseError } from "@/lib/errors";
import { createLogger } from "@/lib/logger";
import { ShippingEasyConfig } from "@/modules/app-config/domain/shippingeasy-config";
import { AppConfigRepo } from "@/modules/app-config/repositories/app-config-repo";
import { SaleorApiUrl } from "@/modules/saleor/saleor-api-url";
import { ShippingEasyClient } from "@/modules/shippingeasy/shippingeasy-client";

import { MetadataKeys } from "./metadata-keys";

const logger = createLogger("CancelShippingEasyOrder");

export const CancelOrderError = {
  NotConfigured: BaseError.subclass("CancelOrderNotConfiguredError", {
    props: { _internalName: "CancelOrderError.NotConfigured" as const },
  }),
  UpstreamFailed: BaseError.subclass("CancelOrderUpstreamFailedError", {
    props: { _internalName: "CancelOrderError.UpstreamFailed" as const },
  }),
  NoLinkedOrder: BaseError.subclass("CancelOrderNoLinkedOrderError", {
    props: { _internalName: "CancelOrderError.NoLinkedOrder" as const },
  }),
};

export type CancelOrderInput = {
  saleorApiUrl: SaleorApiUrl;
  appId: string;
  orderId: string;
  channelSlug: string;
  privateMetadata: ReadonlyArray<{ key: string; value: string }>;
};

export class CancelShippingEasyOrderUseCase {
  constructor(
    private readonly deps: {
      configRepo: AppConfigRepo;
      buildClient: (config: ShippingEasyConfig) => ShippingEasyClient;
    },
  ) {}

  async execute(
    input: CancelOrderInput,
  ): Promise<
    Result<
      { externalOrderId: string },
      | InstanceType<typeof CancelOrderError.NotConfigured>
      | InstanceType<typeof CancelOrderError.UpstreamFailed>
      | InstanceType<typeof CancelOrderError.NoLinkedOrder>
    >
  > {
    const externalOrderId = input.privateMetadata.find(
      (m) => m.key === MetadataKeys.shippingEasyExternalOrderId,
    )?.value;

    if (!externalOrderId) {
      return err(new CancelOrderError.NoLinkedOrder("No ShippingEasy linkage on order"));
    }

    const configResult = await this.deps.configRepo.getConfigByChannel({
      saleorApiUrl: input.saleorApiUrl,
      appId: input.appId,
      channelSlug: input.channelSlug,
    });

    if (configResult.isErr() || !configResult.value) {
      return err(
        new CancelOrderError.NotConfigured(
          `No ShippingEasy config for channel ${input.channelSlug}`,
        ),
      );
    }

    const client = this.deps.buildClient(configResult.value);
    const cancelResult = await client.cancelOrder(externalOrderId);

    if (cancelResult.isErr()) {
      /**
       * If ShippingEasy says "not found" we treat the cancel as a no-op: the
       * order is already gone or was never synced.
       */
      if (cancelResult.error._internalName === "ShippingEasyApiError.NotFound") {
        logger.info("ShippingEasy order already missing; treating as cancelled", {
          externalOrderId,
        });

        return ok({ externalOrderId });
      }

      return err(
        new CancelOrderError.UpstreamFailed("ShippingEasy cancel failed", {
          cause: cancelResult.error,
        }),
      );
    }

    logger.info("Cancelled order in ShippingEasy", { externalOrderId });

    return ok({ externalOrderId });
  }
}
