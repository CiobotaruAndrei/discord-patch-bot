"use strict";

import type { GameConfig } from "../../types";

type MaybePromise<T> = T | Promise<T>;

export type CommandGame = Pick<GameConfig, "key" | "name" | "appId" | "aliases">;

export interface CommandHandler<I = unknown> {
  canHandle(interaction: unknown): interaction is I;
  handle(interaction: I, games: CommandGame[]): MaybePromise<unknown>;
}

export {};
