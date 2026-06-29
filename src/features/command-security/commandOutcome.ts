"use strict";

export interface HandledCommandError {
  readonly handledCommandError: true;
  readonly reason: string;
}

export function handledCommandError(reason = ""): HandledCommandError {
  return { handledCommandError: true, reason: String(reason).slice(0, 300) };
}

export function isHandledCommandError(value: unknown): value is HandledCommandError {
  return typeof value === "object"
    && value !== null
    && (value as { handledCommandError?: unknown }).handledCommandError === true;
}
