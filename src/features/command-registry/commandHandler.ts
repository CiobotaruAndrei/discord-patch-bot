"use strict";

import type { GameConfig } from "../../types";

type MaybePromise<T> = T | Promise<T>;

export interface CommandHandler {
  canHandle(interaction: unknown): boolean;
  handle(interaction: unknown, games: GameConfig[]): MaybePromise<unknown>;
}

export {};
