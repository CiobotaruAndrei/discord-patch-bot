"use strict";

export type NotificationFailureVerdict =
  | { action: "requeue"; attempts: number }
  | { action: "dead-letter"; attempts: number; cause: "permanent" | "max-attempts" };

export function planNotificationFailure(
  previousAttempts: number | undefined,
  maxAttempts: number,
  permanent = false
): NotificationFailureVerdict {
  const attempts = (previousAttempts || 0) + 1;
  if (permanent) return { action: "dead-letter", attempts, cause: "permanent" };
  if (attempts >= maxAttempts) return { action: "dead-letter", attempts, cause: "max-attempts" };
  return { action: "requeue", attempts };
}
