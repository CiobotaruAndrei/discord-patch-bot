"use strict";

import { fingerprintFor, parseFingerprint, parsedNearIdentical } from "./antiRaidFingerprint.js";

import type { AntiRaidThresholds } from "./antiRaidThresholds.js";

export const SPAM_KINDS = ["identical", "mention", "invite", "link", "structure"] as const;
export type SpamKind = (typeof SPAM_KINDS)[number];

export interface RaidSignal {
  actorId: string;
  bot: boolean;
  channelId: string | null;
  kind: SpamKind;
  fingerprint: string;
  weight: number;
  at: number;
}

export interface RaidDetectionVerdict {
  triggered: boolean;
  kinds: SpamKind[];
  actorIds: string[];
  channelIds: string[];
  coordinated: boolean;
  reason: string;
}

const KIND_LABELS: Record<SpamKind, string> = {
  identical: "mesaje identice sau aproape identice",
  mention: "spam cu taguri",
  invite: "spam cu servere, invitatii sau reclame",
  link: "spam cu linkuri sau atasamente",
  structure: "canale sau roluri create ori sterse fara autorizatie"
};

function windowFor(kind: SpamKind, thresholds: AntiRaidThresholds): { count: number; windowMs: number } {
  if (kind === "identical") return { count: thresholds.identicalMessages, windowMs: thresholds.identicalWindowMs };
  if (kind === "mention") return { count: thresholds.mentionCount, windowMs: thresholds.mentionWindowMs };
  if (kind === "invite") return { count: thresholds.inviteMessages, windowMs: thresholds.inviteWindowMs };
  if (kind === "link") return { count: thresholds.linkMessages, windowMs: thresholds.linkWindowMs };
  return { count: thresholds.structureChanges, windowMs: thresholds.structureWindowMs };
}

export function normalizeMessageText(text: string): string {
  return text
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/<[@#&!:][^>]*>/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .slice(0, 200);
}

const INVITE_PATTERN = /(?:discord(?:app)?\.com\/invite|discord\.gg|discord\.me|dsc\.gg|invite\.gg)\/[\w-]+/i;
const LINK_PATTERN = /https?:\/\/\S+|\bwww\.\S+/i;

export interface MessageObservation {
  actorId: string;
  bot: boolean;
  channelId: string | null;
  content: string;
  mentionCount: number;
  attachmentCount: number;
  at: number;
}

export function signalsFromMessage(observation: MessageObservation): RaidSignal[] {
  const base = { actorId: observation.actorId, bot: observation.bot, channelId: observation.channelId, at: observation.at };
  const signals: RaidSignal[] = [];
  const normalized = normalizeMessageText(observation.content);

  if (normalized.length > 0) signals.push({ ...base, kind: "identical", fingerprint: fingerprintFor(normalized), weight: 1 });
  if (observation.mentionCount > 0) {
    signals.push({ ...base, kind: "mention", fingerprint: "mention", weight: observation.mentionCount });
  }
  if (INVITE_PATTERN.test(observation.content)) signals.push({ ...base, kind: "invite", fingerprint: "invite", weight: 1 });
  if (LINK_PATTERN.test(observation.content) || observation.attachmentCount > 0) {
    signals.push({ ...base, kind: "link", fingerprint: "link", weight: 1 });
  }
  return signals;
}

export function structureSignal(actorId: string, bot: boolean, resourceId: string, at: number): RaidSignal {
  return { actorId, bot, channelId: null, kind: "structure", fingerprint: resourceId, weight: 1, at };
}

export interface DetectorOptions {
  thresholds: AntiRaidThresholds;
  maxSignals?: number;
}

const DEFAULT_MAX_SIGNALS = 2_000;
export const MAX_CLUSTER_SCAN = 64;
const MIN_COORDINATED_SIGNALS = 2;

export function createRaidDetector(options: DetectorOptions) {
  const signals: RaidSignal[] = [];
  const maxSignals = options.maxSignals ?? DEFAULT_MAX_SIGNALS;
  const thresholds = options.thresholds;
  const longestWindowMs = Math.max(
    thresholds.identicalWindowMs,
    thresholds.mentionWindowMs,
    thresholds.inviteWindowMs,
    thresholds.linkWindowMs,
    thresholds.coordinatedWindowMs,
    thresholds.structureWindowMs
  );

  function prune(now: number): void {
    const cutoff = now - longestWindowMs;
    let removable = 0;
    while (removable < signals.length && signals[removable].at < cutoff) removable += 1;
    if (removable > 0) signals.splice(0, removable);
    if (signals.length > maxSignals) signals.splice(0, signals.length - maxSignals);
  }

  function clusterNearIdentical(actorSignals: readonly RaidSignal[], count: number): RaidSignal[] {
    const recent = actorSignals.length > MAX_CLUSTER_SCAN
      ? actorSignals.slice(actorSignals.length - MAX_CLUSTER_SCAN)
      : actorSignals;
    const parsed = recent.map(signal => parseFingerprint(signal.fingerprint));

    for (let anchor = 0; anchor < recent.length; anchor += 1) {
      let total = 0;
      const cluster: RaidSignal[] = [];
      for (let index = 0; index < recent.length; index += 1) {
        if (!parsedNearIdentical(parsed[anchor], parsed[index])) continue;
        cluster.push(recent[index]);
        total += recent[index].weight;
      }
      if (total >= count) return cluster;
    }
    return [];
  }

  function breaching(kind: SpamKind, now: number): RaidSignal[] {
    const { count, windowMs } = windowFor(kind, thresholds);
    const buckets = new Map<string, RaidSignal[]>();
    for (const signal of signals) {
      if (signal.kind !== kind || now - signal.at > windowMs) continue;
      const bucket = buckets.get(signal.actorId);
      if (bucket) bucket.push(signal); else buckets.set(signal.actorId, [signal]);
    }
    for (const bucket of buckets.values()) {
      if (kind === "identical") {
        const cluster = clusterNearIdentical(bucket, count);
        if (cluster.length > 0) return cluster;
        continue;
      }
      const total = bucket.reduce((sum, signal) => sum + signal.weight, 0);
      if (total >= count) return bucket;
    }
    return [];
  }

  function evaluate(now: number): RaidDetectionVerdict {
    const kinds: SpamKind[] = [];
    const actorIds = new Set<string>();
    const channelIds = new Set<string>();

    for (const kind of SPAM_KINDS) {
      const bucket = breaching(kind, now);
      if (bucket.length === 0) continue;
      kinds.push(kind);
      for (const signal of bucket) {
        actorIds.add(signal.actorId);
        if (signal.channelId) channelIds.add(signal.channelId);
      }
    }

    if (kinds.length === 0) {
      return { triggered: false, kinds: [], actorIds: [], channelIds: [], coordinated: false, reason: "" };
    }

    const contributions = new Map<string, { count: number; weight: number }>();
    for (const signal of signals) {
      if (!kinds.includes(signal.kind) || now - signal.at > thresholds.coordinatedWindowMs) continue;
      const current = contributions.get(signal.actorId) ?? { count: 0, weight: 0 };
      contributions.set(signal.actorId, { count: current.count + 1, weight: current.weight + signal.weight });
    }
    const coordinatedActors = new Set(actorIds);
    for (const [actorId, contribution] of contributions) {
      if (contribution.count >= MIN_COORDINATED_SIGNALS) coordinatedActors.add(actorId);
    }
    const coordinated = coordinatedActors.size >= thresholds.coordinatedActors;

    return {
      triggered: true,
      kinds,
      actorIds: [...coordinated ? coordinatedActors : actorIds].sort(),
      channelIds: [...channelIds].sort(),
      coordinated,
      reason: `${kinds.map(kind => KIND_LABELS[kind]).join(", ")}${coordinated ? ` (coordonat, ${coordinatedActors.size} participanti)` : ""}`
    };
  }

  function observe(signal: RaidSignal): RaidDetectionVerdict {
    signals.push(signal);
    prune(signal.at);
    return evaluate(signal.at);
  }

  function observeAll(batch: readonly RaidSignal[], now: number): RaidDetectionVerdict {
    for (const signal of batch) signals.push(signal);
    prune(now);
    return evaluate(now);
  }

  function reset(): void {
    signals.length = 0;
  }

  return { observe, observeAll, evaluate, reset, size: () => signals.length };
}

export type RaidDetector = ReturnType<typeof createRaidDetector>;
