import { DynamoDBDocumentClient, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";

import { createLogger } from "@/lib/logger";
import { DynamoMainTable } from "@/modules/dynamodb/dynamo-main-table";

const logger = createLogger("OrderLinkStore");

export type OrderLink = {
  /** Saleor Order ID (global ID). */
  saleorOrderId: string;
  /** ShippingEasy external_order_identifier we generated. */
  externalOrderId: string;
  /** ShippingEasy's internal numeric order ID. */
  shippingEasyOrderId: string;
  channelSlug: string;
};

export interface OrderLinkStore {
  save(args: { saleorApiUrl: string; appId: string; link: OrderLink }): Promise<void>;
  findByExternalId(args: {
    saleorApiUrl: string;
    appId: string;
    externalOrderId: string;
  }): Promise<OrderLink | null>;
}

const skForLink = (externalOrderId: string) => `order-link#${externalOrderId}`;

export class InMemoryOrderLinkStore implements OrderLinkStore {
  private readonly store = new Map<string, OrderLink>();

  async save(args: { saleorApiUrl: string; appId: string; link: OrderLink }): Promise<void> {
    this.store.set(
      `${args.saleorApiUrl}#${args.appId}#${args.link.externalOrderId}`,
      args.link,
    );
  }

  async findByExternalId(args: {
    saleorApiUrl: string;
    appId: string;
    externalOrderId: string;
  }): Promise<OrderLink | null> {
    return (
      this.store.get(`${args.saleorApiUrl}#${args.appId}#${args.externalOrderId}`) ?? null
    );
  }
}

export class DynamoOrderLinkStore implements OrderLinkStore {
  constructor(
    private readonly table: DynamoMainTable,
    private readonly documentClient: DynamoDBDocumentClient,
  ) {}

  async save(args: { saleorApiUrl: string; appId: string; link: OrderLink }): Promise<void> {
    try {
      await this.documentClient.send(
        new PutCommand({
          TableName: this.table.getName(),
          Item: {
            PK: DynamoMainTable.getPrimaryKeyScopedToInstallation({
              saleorApiUrl: args.saleorApiUrl,
              appId: args.appId,
            }),
            SK: skForLink(args.link.externalOrderId),
            ...args.link,
          },
        }),
      );
    } catch (e) {
      logger.warn("Failed to persist order link", { error: e });
    }
  }

  async findByExternalId(args: {
    saleorApiUrl: string;
    appId: string;
    externalOrderId: string;
  }): Promise<OrderLink | null> {
    try {
      const result = await this.documentClient.send(
        new GetCommand({
          TableName: this.table.getName(),
          Key: {
            PK: DynamoMainTable.getPrimaryKeyScopedToInstallation({
              saleorApiUrl: args.saleorApiUrl,
              appId: args.appId,
            }),
            SK: skForLink(args.externalOrderId),
          },
        }),
      );

      if (!result.Item) return null;
      const { saleorOrderId, externalOrderId, shippingEasyOrderId, channelSlug } = result.Item as {
        saleorOrderId?: string;
        externalOrderId?: string;
        shippingEasyOrderId?: string;
        channelSlug?: string;
      };

      if (!saleorOrderId || !externalOrderId || !shippingEasyOrderId || !channelSlug) {
        return null;
      }

      return { saleorOrderId, externalOrderId, shippingEasyOrderId, channelSlug };
    } catch (e) {
      logger.warn("Failed to look up order link", { error: e });

      return null;
    }
  }
}
