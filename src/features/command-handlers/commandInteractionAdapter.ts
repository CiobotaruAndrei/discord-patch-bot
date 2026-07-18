"use strict";

export type ChatInputOptionReader = {
  getSubcommand?(required?: boolean): string;
  getString(name: string, required?: boolean): string | null;
  getInteger(name: string, required?: boolean): number | null;
};

export function readSubcommand(options: ChatInputOptionReader): string {
  return options.getSubcommand?.(false) ?? "";
}

export function readStringOption(options: ChatInputOptionReader, primary: string, fallback: string): string | null {
  return options.getString(primary, false) ?? options.getString(fallback, false);
}

export function readIntegerOption(options: ChatInputOptionReader, primary: string, fallback: string): number | null {
  return options.getInteger(primary, false) ?? options.getInteger(fallback, false);
}
