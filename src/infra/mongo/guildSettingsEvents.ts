"use strict";

import { createGuildSettingsEventBus } from "./guildSettingsEventBus.js";
import type {
  GuildSettingsChangedListener,
  GuildSettingsEventErrorReporter,
  GuildSettingsEventMetrics,
  GuildSettingsRemotePublisher
} from "./guildSettingsEventBus.js";

const defaultBus = createGuildSettingsEventBus();

function publishGuildSettingsChanged(guildId: string): void {
  defaultBus.publish(guildId);
}

function dispatchGuildSettingsChangedLocally(guildId: string): void {
  defaultBus.dispatchLocally(guildId);
}

function subscribeGuildSettingsChanged(listener: GuildSettingsChangedListener): () => void {
  return defaultBus.subscribe(listener);
}

function setGuildSettingsEventErrorReporter(reporter: GuildSettingsEventErrorReporter): void {
  defaultBus.setErrorReporter(reporter);
}

function setGuildSettingsRemotePublisher(publisher: GuildSettingsRemotePublisher | null): void {
  defaultBus.setRemotePublisher(publisher);
}

function attachGuildSettingsEventMetrics(target: GuildSettingsEventMetrics | null): void {
  defaultBus.attachMetrics(target);
}

function resetGuildSettingsEventBus(): void {
  defaultBus.dispose();
}

export {
  defaultBus,
  publishGuildSettingsChanged,
  dispatchGuildSettingsChangedLocally,
  subscribeGuildSettingsChanged,
  setGuildSettingsEventErrorReporter,
  setGuildSettingsRemotePublisher,
  attachGuildSettingsEventMetrics,
  resetGuildSettingsEventBus
};
