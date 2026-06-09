import { CartRecord } from "./cart-record";

/**
 * Lifecycle status of a tracked cart, derived from its persisted state.
 * Order of precedence matters: a converted cart is "Converted" even if a
 * reminder was sent first.
 */
export const CartStatus = {
  /** Customer placed an order — the recovery succeeded. */
  CONVERTED: "CONVERTED",
  /** Customer opted out of further reminders. */
  UNSUBSCRIBED: "UNSUBSCRIBED",
  /** At least one reminder has been sent; awaiting conversion. */
  REMINDED: "REMINDED",
  /** Tracked with an email, no reminder sent yet (awaiting first nudge). */
  AWAITING: "AWAITING",
  /** Tracked but no email captured — cannot be reminded. */
  NO_EMAIL: "NO_EMAIL",
} as const;

export type CartStatusCode = (typeof CartStatus)[keyof typeof CartStatus];

export type CartStatusResult = {
  code: CartStatusCode;
  /** Human label for the dashboard, e.g. "First nudge sent". */
  label: string;
};

export function getCartStatus(cart: CartRecord): CartStatusResult {
  if (cart.recoveredAt) {
    return { code: CartStatus.CONVERTED, label: "Converted" };
  }

  if (cart.unsubscribedAt) {
    return { code: CartStatus.UNSUBSCRIBED, label: "Unsubscribed" };
  }

  const last = cart.lastReminder;

  if (last) {
    return { code: CartStatus.REMINDED, label: `${last.reminderName} sent` };
  }

  if (!cart.email) {
    return { code: CartStatus.NO_EMAIL, label: "No email captured" };
  }

  return { code: CartStatus.AWAITING, label: "Awaiting first reminder" };
}
