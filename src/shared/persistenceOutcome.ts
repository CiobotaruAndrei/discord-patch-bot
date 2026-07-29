"use strict";

export interface WriteCounts {
  matchedCount?: number;
  modifiedCount?: number;
  upsertedCount?: number;
}

export type WriteEffect = "created" | "updated" | "unchanged" | "missing";

function count(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function classifyWrite(result: WriteCounts | null | undefined): WriteEffect {
  if (!result) return "missing";
  if (count(result.upsertedCount) > 0) return "created";
  if (count(result.modifiedCount) > 0) return "updated";
  if (count(result.matchedCount) > 0) return "unchanged";
  return "missing";
}

export function changedDocument(result: WriteCounts | null | undefined): boolean {
  const effect = classifyWrite(result);
  return effect === "created" || effect === "updated";
}

export function createdDocument(result: WriteCounts | null | undefined): boolean {
  return classifyWrite(result) === "created";
}

export function updatedDocument(result: WriteCounts | null | undefined): boolean {
  return classifyWrite(result) === "updated";
}

export function matchedDocument(result: WriteCounts | null | undefined): boolean {
  return classifyWrite(result) !== "missing";
}

export function modifiedDocuments(result: WriteCounts | null | undefined): number {
  return result ? count(result.modifiedCount) : 0;
}
