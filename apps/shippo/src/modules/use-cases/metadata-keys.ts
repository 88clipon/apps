/**
 * Keys used in Saleor order.privateMetadata to track Shippo linkage.
 */
export const MetadataKeys = {
  shippoExternalOrderId: "shippo.external_order_id",
  shippoOrderId: "shippo.order_id",
  shippoTransactionId: "shippo.transaction_id",
  shippoStatus: "shippo.status",
  shippoLastSyncAt: "shippo.last_sync_at",
} as const;

export type MetadataKeyValue = (typeof MetadataKeys)[keyof typeof MetadataKeys];
