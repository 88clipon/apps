import Handlebars from "handlebars";

import { CartRecord } from "@/modules/app-config/domain/cart-record";

/**
 * Template merge context exposed to merchant-supplied Handlebars templates.
 * Keep this list small and stable — once published in a doc, removing fields
 * breaks merchant templates without warning.
 */
export type TemplateContext = {
  customer: {
    firstName: string;
    lastName: string;
    email: string;
  };
  cart: {
    recoveryUrl: string;
    itemCount: number;
    total: string;
    currency: string;
    items: Array<{ name: string; quantity: number; price: string }>;
  };
  store: {
    name: string;
  };
};

export function buildContext(args: {
  cart: CartRecord;
  storefrontUrl: string | undefined;
  storeName: string;
}): TemplateContext {
  const recoveryUrl = args.storefrontUrl
    ? `${args.storefrontUrl.replace(/\/+$/, "")}/${args.cart.channelSlug}/checkout?token=${encodeURIComponent(args.cart.checkoutId)}`
    : "";

  return {
    customer: {
      firstName: args.cart.customerFirstName ?? "",
      lastName: args.cart.customerLastName ?? "",
      email: args.cart.email ?? "",
    },
    cart: {
      recoveryUrl,
      itemCount: args.cart.lines.reduce((sum, l) => sum + l.quantity, 0),
      total: args.cart.totalAmount.toFixed(2),
      currency: args.cart.currency,
      items: args.cart.lines.map((l) => ({
        name: l.name,
        quantity: l.quantity,
        price: l.unitPrice.toFixed(2),
      })),
    },
    store: { name: args.storeName },
  };
}

/**
 * Render a Handlebars template against a context. Compiles each call (cheap
 * for tens of templates; if we ever ship a heavy library, swap in an LRU).
 */
export function renderTemplate(template: string, context: TemplateContext): string {
  return Handlebars.compile(template, { noEscape: false })(context);
}
