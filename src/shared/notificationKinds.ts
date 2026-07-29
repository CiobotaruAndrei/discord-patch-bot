"use strict";

export interface DirectSubscriptionGate {
  mode: "direct";
  enabledField: string;
  channelField: string;
}

export interface RoutedSubscriptionGate {
  mode: "routed";
  enabledField: string;
  channelField: string;
  routeField: string;
}

export type SubscriptionGate = DirectSubscriptionGate | RoutedSubscriptionGate;

export interface NotificationKindDescriptor {
  cronContext: string;
  subscription: SubscriptionGate;
}

export const NOTIFICATION_KIND_REGISTRY = {
  update: {
    cronContext: "CRON_UPDATES",
    subscription: { mode: "direct", enabledField: "subscribed", channelField: "notificationChannelId" }
  },
  discount: {
    cronContext: "CRON_DISCOUNTS",
    subscription: { mode: "direct", enabledField: "discountsSubscribed", channelField: "discountChannelId" }
  },
  youtube: {
    cronContext: "CRON_YOUTUBE",
    subscription: {
      mode: "routed",
      enabledField: "youtubeNotificationsEnabled",
      channelField: "youtubeNotificationChannelId",
      routeField: "youtubeChannelRoutes.discordChannelIds"
    }
  },
  "future-release": {
    cronContext: "CRON_FUTURE_RELEASE",
    subscription: { mode: "direct", enabledField: "futureReleaseSubscribed", channelField: "futureReleaseChannelId" }
  },
  dlc: {
    cronContext: "CRON_DLC",
    subscription: { mode: "direct", enabledField: "dlcSubscribed", channelField: "dlcChannelId" }
  }
} as const satisfies Record<string, NotificationKindDescriptor>;

export type NotificationKind = keyof typeof NOTIFICATION_KIND_REGISTRY;

export const NOTIFICATION_KINDS = Object.keys(NOTIFICATION_KIND_REGISTRY) as readonly NotificationKind[];

export const DEFAULT_NOTIFICATION_KIND: NotificationKind = "update";

export function isNotificationKind(value: unknown): value is NotificationKind {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(NOTIFICATION_KIND_REGISTRY, value);
}

export function notificationKindOr(value: unknown, fallback: NotificationKind = DEFAULT_NOTIFICATION_KIND): NotificationKind {
  return isNotificationKind(value) ? value : fallback;
}

export function descriptorFor(kind: NotificationKind): NotificationKindDescriptor {
  return NOTIFICATION_KIND_REGISTRY[kind];
}

export function cronContextFor(kind: NotificationKind): string {
  return NOTIFICATION_KIND_REGISTRY[kind].cronContext;
}

export function notificationKindForContext(context: string): NotificationKind | undefined {
  return NOTIFICATION_KINDS.find(kind => NOTIFICATION_KIND_REGISTRY[kind].cronContext === context);
}

export interface SubscriptionFilterInput {
  kind: NotificationKind;
  guildId: string;
  channelId: string;
  manual?: boolean;
}

export function subscriptionFilterFor(input: SubscriptionFilterInput): Record<string, unknown> {
  const gate = NOTIFICATION_KIND_REGISTRY[input.kind].subscription;
  if (gate.mode === "routed") {
    return {
      _id: input.guildId,
      ...(input.manual ? {} : { [gate.enabledField]: true }),
      $or: [{ [gate.channelField]: input.channelId }, { [gate.routeField]: input.channelId }]
    };
  }
  return { _id: input.guildId, [gate.enabledField]: true, [gate.channelField]: input.channelId };
}
