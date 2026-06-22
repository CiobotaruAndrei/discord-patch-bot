"use strict";

type MaybePromise<T> = T | Promise<T>;

export interface CommandHandler<I = unknown> {
  canHandle(interaction: unknown): interaction is I;
  handle(interaction: I, games: Array<{ key: string }>): MaybePromise<unknown>;
}

export {};
