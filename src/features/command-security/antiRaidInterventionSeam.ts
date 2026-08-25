"use strict";

export interface RaidInterventionSeam {
  run: (guildId: string) => Promise<boolean>;
  bind: (runner: (guildId: string) => Promise<unknown>) => void;
  isBound: () => boolean;
  captureBaseline: (guildId: string) => Promise<boolean>;
  bindBaseline: (capture: (guildId: string) => Promise<unknown>) => void;
}

export function createRaidInterventionSeam(): RaidInterventionSeam {
  let runner: ((guildId: string) => Promise<unknown>) | null = null;
  let baseline: ((guildId: string) => Promise<unknown>) | null = null;
  return {
    run: async guildId => {
      if (!runner) return false;
      await runner(guildId).catch(() => undefined);
      return true;
    },
    bind: next => { runner = next; },
    isBound: () => runner !== null,
    captureBaseline: async guildId => {
      if (!baseline) return false;
      await baseline(guildId).catch(() => undefined);
      return true;
    },
    bindBaseline: next => { baseline = next; }
  };
}
