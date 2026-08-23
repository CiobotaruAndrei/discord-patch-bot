"use strict";

export const NEAR_IDENTICAL_MAX_DISTANCE = 8;
export const MIN_FUZZY_LENGTH = 8;
export const SHINGLE_SIZE = 3;
export const MAX_FINGERPRINT_SHINGLES = 200;

const EXACT_PREFIX = "exact:";
const SIMILAR_PREFIX = "sim:";

function tokenHash(token: string): { hi: number; lo: number } {
  let hi = 0x811c9dc5;
  let lo = 0x01000193;
  for (let index = 0; index < token.length; index += 1) {
    const code = token.charCodeAt(index);
    hi = Math.imul(hi ^ code, 0x01000193) >>> 0;
    lo = Math.imul(lo + code, 0x85ebca6b) >>> 0;
  }
  return { hi, lo };
}

function simhash(tokens: readonly string[]): { hi: number; lo: number } {
  const weights = new Int32Array(64);
  for (const token of tokens) {
    const { hi, lo } = tokenHash(token);
    for (let bit = 0; bit < 32; bit += 1) {
      weights[bit] += (lo >>> bit) & 1 ? 1 : -1;
      weights[bit + 32] += (hi >>> bit) & 1 ? 1 : -1;
    }
  }
  let hi = 0;
  let lo = 0;
  for (let bit = 0; bit < 32; bit += 1) {
    if (weights[bit] > 0) lo |= 1 << bit;
    if (weights[bit + 32] > 0) hi |= 1 << bit;
  }
  return { hi: hi >>> 0, lo: lo >>> 0 };
}

function popcount(value: number): number {
  let bits = value - ((value >>> 1) & 0x55555555);
  bits = (bits & 0x33333333) + ((bits >>> 2) & 0x33333333);
  bits = (bits + (bits >>> 4)) & 0x0f0f0f0f;
  return (Math.imul(bits, 0x01010101) >>> 24);
}

function shingles(normalized: string): string[] {
  const parts: string[] = [];
  const limit = Math.min(normalized.length - SHINGLE_SIZE + 1, MAX_FINGERPRINT_SHINGLES);
  for (let index = 0; index < limit; index += 1) parts.push(normalized.slice(index, index + SHINGLE_SIZE));
  return parts;
}

export function fingerprintFor(normalized: string): string {
  if (normalized.length < MIN_FUZZY_LENGTH) return `${EXACT_PREFIX}${normalized}`;
  const { hi, lo } = simhash(shingles(normalized));
  return `${SIMILAR_PREFIX}${hi.toString(36)}:${lo.toString(36)}`;
}

export interface ParsedFingerprint {
  exact: string | null;
  hi: number;
  lo: number;
}

export function parseFingerprint(fingerprint: string): ParsedFingerprint {
  const similar = parseSimilar(fingerprint);
  return similar ? { exact: null, ...similar } : { exact: fingerprint, hi: 0, lo: 0 };
}

export function parsedNearIdentical(
  left: ParsedFingerprint,
  right: ParsedFingerprint,
  maxDistance = NEAR_IDENTICAL_MAX_DISTANCE
): boolean {
  if (left.exact !== null || right.exact !== null) return left.exact === right.exact;
  return popcount(left.hi ^ right.hi) + popcount(left.lo ^ right.lo) <= maxDistance;
}

function parseSimilar(fingerprint: string): { hi: number; lo: number } | null {
  if (!fingerprint.startsWith(SIMILAR_PREFIX)) return null;
  const [hi, lo] = fingerprint.slice(SIMILAR_PREFIX.length).split(":");
  const parsedHi = Number.parseInt(hi ?? "", 36);
  const parsedLo = Number.parseInt(lo ?? "", 36);
  if (!Number.isFinite(parsedHi) || !Number.isFinite(parsedLo)) return null;
  return { hi: parsedHi >>> 0, lo: parsedLo >>> 0 };
}

export function fingerprintDistance(left: string, right: string): number | null {
  const first = parseSimilar(left);
  const second = parseSimilar(right);
  if (!first || !second) return null;
  return popcount(first.hi ^ second.hi) + popcount(first.lo ^ second.lo);
}

export function nearIdentical(left: string, right: string, maxDistance = NEAR_IDENTICAL_MAX_DISTANCE): boolean {
  if (left === right) return true;
  const distance = fingerprintDistance(left, right);
  return distance !== null && distance <= maxDistance;
}
