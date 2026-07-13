type GuildSettingsChangedListener = (guildId: string) => void;
type GuildSettingsEventErrorReporter = (guildId: string, error: unknown) => void;

const listeners = new Set<GuildSettingsChangedListener>();

let reportListenerError: GuildSettingsEventErrorReporter = () => undefined;

function setGuildSettingsEventErrorReporter(reporter: GuildSettingsEventErrorReporter): void {
  reportListenerError = reporter;
}

function publishGuildSettingsChanged(guildId: string): void {
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

function subscribeGuildSettingsChanged(listener: GuildSettingsChangedListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export { publishGuildSettingsChanged, subscribeGuildSettingsChanged, setGuildSettingsEventErrorReporter };
