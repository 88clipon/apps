import { AppConfig, Reminder } from "@/modules/app-config/domain/app-config";
import { CartRecord } from "@/modules/app-config/domain/cart-record";

/**
 * Decides whether a tracked cart is due for its next reminder right now.
 *
 * Pure function — no I/O, easy to test. The scheduler loops calls this for
 * each live cart and dispatches whatever it returns.
 */
export type Decision =
  | { kind: "skip"; reason: string }
  | { kind: "send"; reminder: Reminder };

export function decideNextAction(args: {
  cart: CartRecord;
  config: AppConfig;
  now: Date;
  /** Most recent send (any reminder) to this email across the whole repo. */
  latestSendToEmailAt: string | null;
}): Decision {
  if (!args.cart.isLive) return { kind: "skip", reason: "not-live" };
  if (!args.cart.email) return { kind: "skip", reason: "no-email" };

  const program = args.config.programFor(args.cart.channelSlug);

  if (!program) return { kind: "skip", reason: "no-program" };

  // Per-email throttle across the tenant.
  if (args.latestSendToEmailAt) {
    const throttleMs = program.perEmailThrottleHours * 3600 * 1000;
    const elapsedMs = args.now.getTime() - new Date(args.latestSendToEmailAt).getTime();

    if (elapsedMs < throttleMs) return { kind: "skip", reason: "throttled" };
  }

  const sentNames = new Set(args.cart.remindersSent.map((r) => r.reminderName));
  const lastActivity = new Date(args.cart.lastUpdatedAt).getTime();

  /*
   * Walk reminders in declared order; the first not-yet-sent one whose
   * schedule time has elapsed is the one to send.
   */
  for (const reminder of program.reminders) {
    if (sentNames.has(reminder.name)) continue;
    const dueAt = lastActivity + reminder.hoursAfterLastActivity * 3600 * 1000;

    if (args.now.getTime() >= dueAt) return { kind: "send", reminder };

    /*
     * Reminders are declared in order. If this one isn't due yet, none after
     * it will be either.
     */
    return { kind: "skip", reason: "next-reminder-not-due-yet" };
  }

  return { kind: "skip", reason: "all-reminders-sent" };
}
