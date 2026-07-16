type GuildSettingsChangedListener = (guildId: string) => void;
type GuildSettingsEventErrorReporter = (guildId: string, error: unknown) => void;
type GuildSettingsRemotePublisher = (guildId: string) => void;

interface GuildSettingsEventMetrics {
  guildSettingsListenerFailures: number;
}

const listeners = new Set<GuildSettingsChangedListener>();

let reportListenerError: GuildSettingsEventErrorReporter = () => undefined;
let remotePublisher: GuildSettingsRemotePublisher | null = null;
let metricsRef: GuildSettingsEventMetrics | null = null;

function setGuildSettingsEventErrorReporter(reporter: GuildSettingsEventErrorReporter): void {
  reportListenerError = reporter;
}

function setGuildSettingsRemotePublisher(publisher: GuildSettingsRemotePublisher | null): void {
  remotePublisher = publisher;
}

function attachGuildSettingsEventMetrics(target: GuildSettingsEventMetrics | null): void {
  metricsRef = target;
}

function recordListenerFailure(guildId: string, error: unknown): void {
  if (metricsRef) metricsRef.guildSettingsListenerFailures += 1;
  try {
    reportListenerError(guildId, error);
  } catch (reporterError: unknown) {
    try {
      console.error(`Listener GuildSettingsChanged a esuat pentru guild ${guildId}, iar reporterul de erori a aruncat si el`, error, reporterError);
    } catch {  }
  }
}

function dispatchGuildSettingsChangedLocally(guildId: string): void {
  for (const listener of listeners) {
    try {
      listener(guildId);
    } catch (error: unknown) {
      recordListenerFailure(guildId, error);
    }
  }
}

function publishGuildSettingsChanged(guildId: string): void {
  dispatchGuildSettingsChangedLocally(guildId);
  if (!remotePublisher) return;
  try {
    remotePublisher(guildId);
  } catch (error: unknown) {
    recordListenerFailure(guildId, error);
  }
}

function subscribeGuildSettingsChanged(listener: GuildSettingsChangedListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export {
  publishGuildSettingsChanged,
  dispatchGuildSettingsChangedLocally,
  subscribeGuildSettingsChanged,
  setGuildSettingsEventErrorReporter,
  setGuildSettingsRemotePublisher,
  attachGuildSettingsEventMetrics
};
