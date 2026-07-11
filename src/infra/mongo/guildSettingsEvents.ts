type GuildSettingsChangedListener = (guildId: string) => void;

const listeners = new Set<GuildSettingsChangedListener>();

function publishGuildSettingsChanged(guildId: string): void {
  for (const listener of listeners) listener(guildId);
}

function subscribeGuildSettingsChanged(listener: GuildSettingsChangedListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export { publishGuildSettingsChanged, subscribeGuildSettingsChanged };

