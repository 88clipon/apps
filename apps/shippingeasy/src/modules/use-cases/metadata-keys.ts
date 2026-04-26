/**
 * Keys used in Saleor order.privateMetadata to track the ShippingEasy linkage.
 * Centralized so all use cases agree on names.
 */
export const MetadataKeys = {
  shippingEasyOrderId: "shippingeasy.order_id",
  shippingEasyExternalOrderId: "shippingeasy.external_order_id",
  shippingEasyStoreId: "shippingeasy.store_id",
  shippingEasyStatus: "shippingeasy.status",
  shippingEasyLastSyncAt: "shippingeasy.last_sync_at",
} as const;

export type MetadataKeyValue = (typeof MetadataKeys)[keyof typeof MetadataKeys];
