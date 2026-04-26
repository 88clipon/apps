import { BaseError } from "@/lib/errors";

export const ShippingEasyApiError = {
  Unauthorized: BaseError.subclass("ShippingEasyUnauthorizedError", {
    props: { _internalName: "ShippingEasyApiError.Unauthorized" as const },
  }),
  BadRequest: BaseError.subclass("ShippingEasyBadRequestError", {
    props: { _internalName: "ShippingEasyApiError.BadRequest" as const },
  }),
  NotFound: BaseError.subclass("ShippingEasyNotFoundError", {
    props: { _internalName: "ShippingEasyApiError.NotFound" as const },
  }),
  RateLimited: BaseError.subclass("ShippingEasyRateLimitedError", {
    props: { _internalName: "ShippingEasyApiError.RateLimited" as const },
  }),
  ServerError: BaseError.subclass("ShippingEasyServerError", {
    props: { _internalName: "ShippingEasyApiError.ServerError" as const },
  }),
  NetworkError: BaseError.subclass("ShippingEasyNetworkError", {
    props: { _internalName: "ShippingEasyApiError.NetworkError" as const },
  }),
  Timeout: BaseError.subclass("ShippingEasyTimeoutError", {
    props: { _internalName: "ShippingEasyApiError.Timeout" as const },
  }),
  InvalidResponse: BaseError.subclass("ShippingEasyInvalidResponseError", {
    props: { _internalName: "ShippingEasyApiError.InvalidResponse" as const },
  }),
  InvalidSignature: BaseError.subclass("ShippingEasyInvalidSignatureError", {
    props: { _internalName: "ShippingEasyApiError.InvalidSignature" as const },
  }),
};

export type ShippingEasyApiErrorInstance =
  | InstanceType<typeof ShippingEasyApiError.Unauthorized>
  | InstanceType<typeof ShippingEasyApiError.BadRequest>
  | InstanceType<typeof ShippingEasyApiError.NotFound>
  | InstanceType<typeof ShippingEasyApiError.RateLimited>
  | InstanceType<typeof ShippingEasyApiError.ServerError>
  | InstanceType<typeof ShippingEasyApiError.NetworkError>
  | InstanceType<typeof ShippingEasyApiError.Timeout>
  | InstanceType<typeof ShippingEasyApiError.InvalidResponse>;
