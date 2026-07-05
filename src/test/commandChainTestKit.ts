"use strict";

type ChainHandle = (interaction: unknown, games?: unknown) => Promise<unknown> | unknown;

interface BuiltCommand {
  canHandle: (interaction: unknown) => boolean;
  handle: ChainHandle;
  handlers?: Record<string, unknown>;
}

export interface ChainableCommandModule {
  buildCommandHandler: (context: Record<string, unknown>) => BuiltCommand;
}

export function installCommandChain(context: Record<string, unknown>, modules: ChainableCommandModule[]): void {
  for (const mod of modules) {
    const previous = context.handleInteraction as ChainHandle | undefined;
    const built = mod.buildCommandHandler(context);
    if (built.handlers) Object.assign(context, built.handlers);
    context.handleInteraction = async (interaction: unknown, games?: unknown) => {
      if (!built.canHandle(interaction)) {
        return typeof previous === "function" ? previous(interaction, games) : undefined;
      }
      return built.handle(interaction, games);
    };
  }
}
