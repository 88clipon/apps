import { err, ok, Result } from "neverthrow";

import { BaseError } from "@/lib/errors";
import { createLogger } from "@/lib/logger";
import { ShippoAppConfig } from "@/modules/app-config/domain/shippo-app-config";
import { AppConfigRepo } from "@/modules/app-config/repositories/app-config-repo";
import { SaleorApiUrl } from "@/modules/saleor/saleor-api-url";
import { ShippoClient } from "@/modules/shippo/shippo-client";

import { MetadataKeys } from "./metadata-keys";

const logger = createLogger("CancelShippoTransaction");

export const CancelShippoError = {
  NotConfigured: BaseError.subclass("CancelShippoNotConfiguredError", {
    props: { _internalName: "CancelShippoError.NotConfigured" as const },
  }),
  UpstreamFailed: BaseError.subclass("CancelShippoUpstreamFailedError", {
    props: { _internalName: "CancelShippoError.UpstreamFailed" as const },
  }),
  NoLinkedTransaction: BaseError.subclass("CancelShippoNoLinkedTransactionError", {
    props: { _internalName: "CancelShippoError.NoLinkedTransaction" as const },
  }),
};

export type CancelShippoInput = {
  saleorApiUrl: SaleorApiUrl;
  appId: string;
  orderId: string;
  channelSlug: string;
  privateMetadata: ReadonlyArray<{ key: string; value: string }>;
};

export class CancelShippoTransactionUseCase {
  constructor(
    private readonly deps: {
      configRepo: AppConfigRepo;
      buildShippoClient: (config: ShippoAppConfig) => ShippoClient | null;
    },
  ) {}

  async execute(
    input: CancelShippoInput,
  ): Promise<
    Result<
      { transactionId: string | null },
      | InstanceType<typeof CancelShippoError.NotConfigured>
      | InstanceType<typeof CancelShippoError.UpstreamFailed>
      | InstanceType<typeof CancelShippoError.NoLinkedTransaction>
    >
  > {
    const transactionId = input.privateMetadata.find(
      (m) => m.key === MetadataKeys.shippoTransactionId,
    )?.value;

    if (!transactionId) {
      return err(new CancelShippoError.NoLinkedTransaction("No Shippo transaction on order"));
    }

    const configResult = await this.deps.configRepo.getConfigByChannel({
      saleorApiUrl: input.saleorApiUrl,
      appId: input.appId,
      channelSlug: input.channelSlug,
    });

    if (configResult.isErr() || !configResult.value) {
      return err(
        new CancelShippoError.NotConfigured(`No Shippo config for channel ${input.channelSlug}`),
      );
    }

    const client = this.deps.buildShippoClient(configResult.value);

    if (!client) {
      return err(
        new CancelShippoError.NotConfigured("Shippo API token is not configured for this channel"),
      );
    }

    const refundResult = await client.createRefund({ transactionObjectId: transactionId });

    if (refundResult.isErr()) {
      /**
       * Unused labels can be refunded; used labels return an error — treat as upstream.
       */
      logger.warn("Shippo refund request failed", { transactionId, message: refundResult.error.message });

      return err(
        new CancelShippoError.UpstreamFailed("Shippo refund failed", { cause: refundResult.error }),
      );
    }

    logger.info("Requested Shippo refund for transaction", { transactionId });

    return ok({ transactionId });
  }
}
