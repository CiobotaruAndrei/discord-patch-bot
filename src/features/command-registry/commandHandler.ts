"use strict";

type MaybePromise<T> = T | Promise<T>;

export type CommandGame = { key: string; name: string };

export interface CommandHandler<I = unknown> {
  canHandle(interaction: unknown): interaction is I;
  handle(interaction: I, games: CommandGame[]): MaybePromise<unknown>;
}

export {};
