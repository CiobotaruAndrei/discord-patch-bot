"use strict";

type MaybePromise<T> = T | Promise<T>;

export interface CommandHandler {
  canHandle(interaction: unknown): boolean;
  handle(interaction: unknown, games: Array<{ key: string }>): MaybePromise<unknown>;
}

export {};
