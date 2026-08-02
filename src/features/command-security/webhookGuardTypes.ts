"use strict";

export interface WebhookSnapshotEntry {
  webhookId: string;
  channelId: string;
  name: string;
  avatar: string | null;
  creatorId: string | null;
}

export interface WebhookSnapshotRecord {
  _id: string;
  guildId: string;
  channelId: string;
  entries: WebhookSnapshotEntry[];
  capturedAt: Date;
}

export type WebhookChangeKind = "create" | "update" | "delete";

export interface WebhookChange {
  kind: WebhookChangeKind;
  webhookId: string;
  name: string;
  previous: WebhookSnapshotEntry | null;
  current: WebhookSnapshotEntry | null;
}

export const WEBHOOK_AUDIT_ACTIONS: Record<WebhookChangeKind, string> = {
  create: "creare",
  update: "editare",
  delete: "stergere"
};

function sameEntry(left: WebhookSnapshotEntry, right: WebhookSnapshotEntry): boolean {
  return left.name === right.name && left.avatar === right.avatar && left.channelId === right.channelId;
}

export function diffWebhooks(
  previous: readonly WebhookSnapshotEntry[],
  current: readonly WebhookSnapshotEntry[]
): WebhookChange[] {
  const previousById = new Map(previous.map(entry => [entry.webhookId, entry]));
  const currentById = new Map(current.map(entry => [entry.webhookId, entry]));
  const changes: WebhookChange[] = [];

  for (const entry of current) {
    const before = previousById.get(entry.webhookId);
    if (!before) {
      changes.push({ kind: "create", webhookId: entry.webhookId, name: entry.name, previous: null, current: entry });
      continue;
    }
    if (!sameEntry(before, entry)) {
      changes.push({ kind: "update", webhookId: entry.webhookId, name: entry.name, previous: before, current: entry });
    }
  }

  for (const entry of previous) {
    if (currentById.has(entry.webhookId)) continue;
    changes.push({ kind: "delete", webhookId: entry.webhookId, name: entry.name, previous: entry, current: null });
  }

  return changes.sort((left, right) => left.webhookId.localeCompare(right.webhookId));
}

export function describeChanges(changes: readonly WebhookChange[]): string {
  return changes
    .map(change => `${WEBHOOK_AUDIT_ACTIONS[change.kind]} \`${change.name || change.webhookId}\``)
    .join(", ");
}

export function changeActions(changes: readonly WebhookChange[]): string[] {
  return [...new Set(changes.map(change => change.kind))].sort();
}
