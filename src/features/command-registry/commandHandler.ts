"use strict";

import type { GameConfig } from "../../types.js";

type MaybePromise<T> = T | Promise<T>;

export type CommandGame = Pick<GameConfig, "key" | "name" | "appId" | "aliases">;

export interface RoutedDiscordInteraction {
  commandName?: string;
  guild?: { id?: string } | null;
  user?: { id?: string } | null;
  isChatInputCommand?: () => boolean;
  isAutocomplete?: () => boolean;
  isButton?: () => boolean;
  isModalSubmit?: () => boolean;
}

export interface CommandHandler<I = unknown> {
  canHandle(interaction: unknown): interaction is I;
  handle(interaction: I, games: CommandGame[]): MaybePromise<unknown>;
}

export {};
