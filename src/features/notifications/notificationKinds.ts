"use strict";

export const NOTIFICATION_KIND_REGISTRY = {
  update: { cronContext: "CRON_UPDATES" },
  discount: { cronContext: "CRON_DISCOUNTS" },
  youtube: { cronContext: "CRON_YOUTUBE" },
  "future-release": { cronContext: "CRON_FUTURE_RELEASE" },
  dlc: { cronContext: "CRON_DLC" }
} as const;

export type NotificationKind = keyof typeof NOTIFICATION_KIND_REGISTRY;

export const NOTIFICATION_KINDS = Object.keys(NOTIFICATION_KIND_REGISTRY) as readonly NotificationKind[];

export const DEFAULT_NOTIFICATION_KIND: NotificationKind = "update";

export function isNotificationKind(value: unknown): value is NotificationKind {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(NOTIFICATION_KIND_REGISTRY, value);
}

export function cronContextFor(kind: NotificationKind): string {
  return NOTIFICATION_KIND_REGISTRY[kind].cronContext;
}

export function notificationKindForContext(context: string): NotificationKind | undefined {
  return NOTIFICATION_KINDS.find(kind => NOTIFICATION_KIND_REGISTRY[kind].cronContext === context);
}
