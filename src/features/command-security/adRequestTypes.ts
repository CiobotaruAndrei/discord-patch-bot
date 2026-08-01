"use strict";

export const AD_REQUEST_STATUSES = ["pending", "approved", "rejected", "used", "expired", "cancelled"] as const;
export type AdRequestStatus = (typeof AD_REQUEST_STATUSES)[number];

export const AD_STRIKE_LIMIT = 3;

export interface AdRequestRecord {
  _id: string;
  guildId: string;
  requesterId: string;
  adText: string;
  fingerprint: string;
  link: string | null;
  invite: string | null;
  attachmentUrl: string | null;
  target: string | null;
  status: AdRequestStatus;
  ownerId: string | null;
  requestedAt: Date;
  respondedAt: Date | null;
  usedAt: Date | null;
  expiresAt: Date | null;
}

export interface AdAttemptRecord {
  _id: string;
  guildId: string;
  userId: string;
  strikes: number;
  totalDeleted: number;
  totalWarns: number;
  lastAttemptAt: Date | null;
  lastChannelId: string | null;
  history: Array<{ at: Date; channelId: string | null; summary: string; warned: boolean }>;
}

const NEWLINE = String.fromCharCode(10);

const INVITE_PATTERN = /(?:discord(?:app)?\.com\/invite|discord\.gg|discord\.me|dsc\.gg|invite\.gg)\/[\w-]+/i;
const LINK_PATTERN = /https?:\/\/[^\s]+|\bwww\.[^\s]+/i;

const PROMO_PHRASES = [
  "intra pe serverul", "intrati pe serverul", "vino pe serverul", "veniti pe server",
  "server nou", "serverul meu", "comunitatea mea", "canalul meu", "pagina mea",
  "aboneaza-te", "abonati-va", "urmariti-ma", "urmareste-ma", "follow me", "subscribe",
  "join my", "join our", "check out my", "check my channel", "promovez", "promovare",
  "vand", "vinde", "vandut", "cumpara de la", "reducere la magazinul", "cont de vanzare",
  "boost ieftin", "nitro gratis", "free nitro", "giveaway pe serverul"
];

export function quoteUntrusted(text: string): string {
  return text
    .replace(/```/g, "` ``")
    .split(NEWLINE)
    .map(line => `> ${line}`)
    .join(NEWLINE);
}

export function normalizeAdText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s:/.@-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export interface AdAttachmentIdentity {
  name?: string | null;
  size?: number | null;
}

export function attachmentIdentity(attachment: AdAttachmentIdentity | null): string {
  if (!attachment) return "";
  const name = typeof attachment.name === "string" ? attachment.name.toLowerCase() : "";
  const size = typeof attachment.size === "number" && Number.isFinite(attachment.size) ? attachment.size : 0;
  return name || size ? `${name}:${size}` : "";
}

export function adFingerprint(text: string, attachment: AdAttachmentIdentity | null): string {
  const normalized = normalizeAdText(text).replace(/\s+/g, "");
  return `${normalized.slice(0, 300)}::${attachmentIdentity(attachment)}`;
}

export function extractInvite(text: string): string | null {
  return INVITE_PATTERN.exec(text)?.[0] ?? null;
}

export function extractLink(text: string): string | null {
  return LINK_PATTERN.exec(text)?.[0] ?? null;
}

export interface AdDetection {
  isAd: boolean;
  reasons: string[];
  invite: string | null;
  link: string | null;
}

export function detectAd(text: string, attachmentCount: number): AdDetection {
  const normalized = normalizeAdText(text);
  const invite = extractInvite(text);
  const link = extractLink(text);
  const reasons: string[] = [];

  if (invite) reasons.push("invitatie catre alt server");
  const phrase = PROMO_PHRASES.find(candidate => normalized.includes(candidate));
  if (phrase) reasons.push(`formulare de promovare: „${phrase}"`);
  if (link && phrase) reasons.push("link insotit de text de promovare");
  if (!invite && !phrase && link && attachmentCount > 0) reasons.push("link plus atasament promotional");

  return { isAd: reasons.length > 0, reasons, invite, link };
}

export function scopeMatchesAdApproval(record: AdRequestRecord, fingerprint: string, requesterId: string): boolean {
  return record.requesterId === requesterId && record.fingerprint === fingerprint;
}

export type StrikeOutcome =
  | { kind: "first"; strikes: number }
  | { kind: "warning"; strikes: number }
  | { kind: "warn-issued"; strikes: number };

export function strikeOutcome(strikesAfter: number): StrikeOutcome {
  if (strikesAfter >= AD_STRIKE_LIMIT) return { kind: "warn-issued", strikes: AD_STRIKE_LIMIT };
  if (strikesAfter === AD_STRIKE_LIMIT - 1) return { kind: "warning", strikes: strikesAfter };
  return { kind: "first", strikes: strikesAfter };
}

export function describeStrike(outcome: StrikeOutcome): string {
  if (outcome.kind === "warn-issued") {
    return `Reclama a fost stearsa. Tentativa ${AD_STRIKE_LIMIT}/${AD_STRIKE_LIMIT}: a fost adaugat automat un warn. Contorul revine la 0/${AD_STRIKE_LIMIT}, iar istoricul ramane salvat.`;
  }
  if (outcome.kind === "warning") {
    return `Reclama a fost stearsa. Tentativa ${outcome.strikes}/${AD_STRIKE_LIMIT}. Urmatoarea tentativa produce un warn automat.`;
  }
  return `Reclama a fost stearsa. Tentativa ${outcome.strikes}/${AD_STRIKE_LIMIT}.`;
}
