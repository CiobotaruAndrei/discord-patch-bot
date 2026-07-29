"use strict";

export type GuildSettingsChangedListener = (guildId: string) => void;
export type GuildSettingsEventErrorReporter = (guildId: string, error: unknown) => void;
export type GuildSettingsRemotePublisher = (guildId: string) => void;

export interface GuildSettingsEventMetrics {
  guildSettingsListenerFailures: number;
}

export interface GuildSettingsEventBus {
  publish: (guildId: string) => void;
  dispatchLocally: (guildId: string) => void;
  subscribe: (listener: GuildSettingsChangedListener) => () => void;
  setErrorReporter: (reporter: GuildSettingsEventErrorReporter) => void;
  setRemotePublisher: (publisher: GuildSettingsRemotePublisher | null) => void;
  attachMetrics: (target: GuildSettingsEventMetrics | null) => void;
  listenerCount: () => number;
  dispose: () => void;
}

export function createGuildSettingsEventBus(): GuildSettingsEventBus {
  const listeners = new Set<GuildSettingsChangedListener>();
  let reportListenerError: GuildSettingsEventErrorReporter = () => undefined;
  let remotePublisher: GuildSettingsRemotePublisher | null = null;
  let metricsRef: GuildSettingsEventMetrics | null = null;

  function recordListenerFailure(guildId: string, error: unknown): void {
    if (metricsRef) metricsRef.guildSettingsListenerFailures += 1;
    try {
      reportListenerError(guildId, error);
    } catch (reporterError: unknown) {
      try {
        console.error(
          `Listener GuildSettingsChanged a esuat pentru guild ${guildId}, iar reporterul de erori a aruncat si el`,
          error,
          reporterError
        );
      } catch {  }
    }
  }

  function dispatchLocally(guildId: string): void {
    for (const listener of listeners) {
      try {
        listener(guildId);
      } catch (error: unknown) {
        recordListenerFailure(guildId, error);
      }
    }
  }

  return {
    dispatchLocally,
    publish(guildId: string): void {
      dispatchLocally(guildId);
      if (!remotePublisher) return;
      try {
        remotePublisher(guildId);
      } catch (error: unknown) {
        recordListenerFailure(guildId, error);
      }
    },
    subscribe(listener: GuildSettingsChangedListener): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setErrorReporter(reporter: GuildSettingsEventErrorReporter): void {
      reportListenerError = reporter;
    },
    setRemotePublisher(publisher: GuildSettingsRemotePublisher | null): void {
      remotePublisher = publisher;
    },
    attachMetrics(target: GuildSettingsEventMetrics | null): void {
      metricsRef = target;
    },
    listenerCount(): number {
      return listeners.size;
    },
    dispose(): void {
      listeners.clear();
      remotePublisher = null;
      metricsRef = null;
      reportListenerError = () => undefined;
    }
  };
}
