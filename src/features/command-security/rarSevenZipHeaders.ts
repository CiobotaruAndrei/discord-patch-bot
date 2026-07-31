"use strict";


export interface HeaderEntry {
  name: string;
  encrypted: boolean;
  directory: boolean;
}

export interface HeaderScan {
  entries: HeaderEntry[];
  encryptedHeaders: boolean;
  truncated: string | null;
}

const RAR4_SIGNATURE = Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00]);

import { enforceBudget, inspected, uncertain } from "./archiveInspectionBudget.js";
import type { InspectionBudget, PassiveArchiveFinding } from "./archiveInspectionBudget.js";

function decodeOemName(raw: Buffer): string {
  const end = raw.indexOf(0);
  return raw.subarray(0, end === -1 ? raw.length : end).toString("latin1");
}

export function readVint(buffer: Buffer, offset: number): { value: number; used: number } | null {
  let value = 0;
  let shift = 1;
  let cursor = offset;
  while (cursor < buffer.length && cursor - offset < 10) {
    const byte = buffer[cursor];
    value += (byte & 0x7f) * shift;
    cursor++;
    if ((byte & 0x80) === 0) return { value, used: cursor - offset };
    shift *= 128;
  }
  return null;
}

export function scanRar4Headers(buffer: Buffer, budget: InspectionBudget): HeaderScan {
  const scan: HeaderScan = { entries: [], encryptedHeaders: false, truncated: null };
  let offset = 7;
  while (offset + 7 <= buffer.length) {
    const headFlags = buffer.readUInt16LE(offset + 3);
    const headSize = buffer.readUInt16LE(offset + 5);
    if (headSize < 7) {
      scan.truncated = "structura RAR trunchiata sau necunoscuta";
      return scan;
    }
    const headType = buffer[offset + 2];
    if (headType === 0x7b) return scan;
    let dataSize = 0;
    if ((headFlags & 0x8000) !== 0) {
      dataSize = offset + 11 <= buffer.length ? buffer.readUInt32LE(offset + 7) : 0;
    }
    if (headType === 0x74) {
      if (offset + 32 > buffer.length) {
        scan.truncated = "header RAR trunchiat";
        return scan;
      }
      const nameSize = buffer.readUInt16LE(offset + 26);
      const nameOffset = offset + 32 + ((headFlags & 0x0100) !== 0 ? 8 : 0);
      if (nameOffset + nameSize > buffer.length) {
        scan.truncated = "nume de intrare RAR trunchiat";
        return scan;
      }
      const limitFailure = enforceBudget(budget, 0, 0);
      if (limitFailure) {
        scan.truncated = limitFailure;
        return scan;
      }
      scan.entries.push({
        name: decodeOemName(buffer.subarray(nameOffset, nameOffset + nameSize)),
        encrypted: (headFlags & 0x0004) !== 0,
        directory: (headFlags & 0x00e0) === 0x00e0
      });
    }
    const advance = headSize + dataSize;
    if (advance <= 0) {
      scan.truncated = "structura RAR trunchiata sau necunoscuta";
      return scan;
    }
    offset += advance;
  }
  if (offset < buffer.length) scan.truncated = "header RAR trunchiat";
  return scan;
}

export function readRar5FileName(buffer: Buffer, offset: number): { name: string; fileFlags: number } | null {
  let cursor = offset;
  const fileFlags = readVint(buffer, cursor);
  if (!fileFlags) return null;
  cursor += fileFlags.used;
  const unpackedSize = readVint(buffer, cursor);
  if (!unpackedSize) return null;
  cursor += unpackedSize.used;
  const attributes = readVint(buffer, cursor);
  if (!attributes) return null;
  cursor += attributes.used;
  if ((fileFlags.value & 0x0002) !== 0) cursor += 4;
  if ((fileFlags.value & 0x0004) !== 0) cursor += 4;
  const compression = readVint(buffer, cursor);
  if (!compression) return null;
  cursor += compression.used;
  const hostOs = readVint(buffer, cursor);
  if (!hostOs) return null;
  cursor += hostOs.used;
  const nameLength = readVint(buffer, cursor);
  if (!nameLength) return null;
  cursor += nameLength.used;
  const end = cursor + nameLength.value;
  if (end > buffer.length) return null;
  return { name: buffer.subarray(cursor, end).toString("utf8"), fileFlags: fileFlags.value };
}

export function scanRar5Headers(buffer: Buffer, budget: InspectionBudget): HeaderScan {
  const scan: HeaderScan = { entries: [], encryptedHeaders: false, truncated: null };
  let offset = 8;
  const fail = (reason: string): HeaderScan => {
    scan.truncated = reason;
    return scan;
  };
  while (offset + 5 <= buffer.length) {
    let cursor = offset + 4;
    const headerSize = readVint(buffer, cursor);
    if (!headerSize) return fail("structura RAR trunchiata sau necunoscuta");
    cursor += headerSize.used;
    const headerStart = cursor;
    const headerType = readVint(buffer, cursor);
    if (!headerType) return fail("structura RAR trunchiata sau necunoscuta");
    cursor += headerType.used;
    const headerFlags = readVint(buffer, cursor);
    if (!headerFlags) return fail("structura RAR trunchiata sau necunoscuta");
    cursor += headerFlags.used;
    if ((headerFlags.value & 0x0001) !== 0) {
      const extra = readVint(buffer, cursor);
      if (!extra) return fail("structura RAR trunchiata sau necunoscuta");
      cursor += extra.used;
    }
    let dataSize = 0;
    if ((headerFlags.value & 0x0002) !== 0) {
      const declared = readVint(buffer, cursor);
      if (!declared) return fail("structura RAR trunchiata sau necunoscuta");
      dataSize = declared.value;
      cursor += declared.used;
    }
    if (headerType.value === 4) {
      scan.encryptedHeaders = true;
      return scan;
    }
    if (headerType.value === 5) return scan;
    if (headerType.value === 2 || headerType.value === 3) {
      const parsed = readRar5FileName(buffer, cursor);
      if (!parsed) return fail("nume de intrare RAR trunchiat");
      if (headerType.value === 2) {
        const limitFailure = enforceBudget(budget, 0, 0);
        if (limitFailure) return fail(limitFailure);
        scan.entries.push({ name: parsed.name, encrypted: false, directory: (parsed.fileFlags & 0x0001) !== 0 });
      }
    }
    const advance = headerStart - offset + headerSize.value + dataSize;
    if (advance <= 0) return fail("structura RAR trunchiata sau necunoscuta");
    offset += advance;
  }
  if (offset < buffer.length) scan.truncated = "header RAR trunchiat";
  return scan;
}

export function scanSevenZipHeaders(buffer: Buffer): HeaderScan {
  const scan: HeaderScan = { entries: [], encryptedHeaders: false, truncated: null };
  const nextOffset = Number(buffer.readBigUInt64LE(12));
  const nextSize = Number(buffer.readBigUInt64LE(20));
  const start = nextOffset + 32;
  const end = start + nextSize;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || nextSize === 0 || end > buffer.length) {
    scan.truncated = "structura 7z trunchiata sau necunoscuta";
    return scan;
  }
  if (buffer[start] === 0x17) {
    scan.encryptedHeaders = true;
    return scan;
  }
  if (buffer[start] !== 0x01) scan.truncated = "structura 7z trunchiata sau necunoscuta";
  return scan;
}
