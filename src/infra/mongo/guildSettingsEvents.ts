type GuildSettingsChangedListener = (guildId: string) => void;
type GuildSettingsEventErrorReporter = (guildId: string, error: unknown) => void;
type GuildSettingsRemotePublisher = (guildId: string) => void;

const listeners = new Set<GuildSettingsChangedListener>();

let reportListenerError: GuildSettingsEventErrorReporter = () => undefined;
let remotePublisher: GuildSettingsRemotePublisher | null = null;

function setGuildSettingsEventErrorReporter(reporter: GuildSettingsEventErrorReporter): void {
  reportListenerError = reporter;
}

function setGuildSettingsRemotePublisher(publisher: GuildSettingsRemotePublisher | null): void {
  remotePublisher = publisher;
}

function dispatchGuildSettingsChangedLocally(guildId: string): void {
  for (const listener of listeners) {
    try {
      listener(guildId);
    } catch (error: unknown) {
      try {
        reportListenerError(guildId, error);
      } catch {  }
    }
  }
}

function publishGuildSettingsChanged(guildId: string): void {
  dispatchGuildSettingsChangedLocally(guildId);
  if (!remotePublisher) return;
  try {
    remotePublisher(guildId);
  } catch (error: unknown) {
    try {
      reportListenerError(guildId, error);
    } catch {  }
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
  setGuildSettingsRemotePublisher
};
