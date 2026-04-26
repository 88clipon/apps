import { err, ok, Result } from "neverthrow";
import { z } from "zod";

import { BaseError } from "@/lib/errors";

const schema = z.string().url().endsWith("/graphql/").brand("SaleorApiUrl");

export type SaleorApiUrl = z.infer<typeof schema>;

export const SaleorApiUrlValidationError = BaseError.subclass("SaleorApiUrlValidationError", {
  props: { _internalName: "SaleorApiUrl.ValidationError" as const },
});

export const createSaleorApiUrl = (
  raw: string,
): Result<SaleorApiUrl, InstanceType<typeof SaleorApiUrlValidationError>> => {
  const parsed = schema.safeParse(raw);

  if (!parsed.success) {
    return err(new SaleorApiUrlValidationError("Invalid Saleor API URL", { cause: parsed.error }));
  }

  return ok(parsed.data);
};
