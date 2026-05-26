import type { GameConfig } from "../../types";

type MaybePromise<T> = T | Promise<T>;
type RegistryFunction = (...args: unknown[]) => MaybePromise<unknown>;
type CommandModuleInstaller = (context: CommandRegistryContext) => void;

interface CommandRegistryContext {
  cleanCache?: RegistryFunction;
  getCacheSizes?: RegistryFunction;
  setGlobalCacheTtl?: RegistryFunction;
  checkForUpdates?: (games?: GameConfig[]) => MaybePromise<unknown>;
  checkForDiscounts?: RegistryFunction;
  buildOptimizedGameList?: (allGames: GameConfig[], subscribedGuilds: unknown[]) => GameConfig[];
  registerSlashCommands?: (token: string, clientId: string) => MaybePromise<unknown>;
  buildSlashCommandDefinitions?: RegistryFunction;
  handleInteraction?: (interaction: unknown, games: GameConfig[]) => MaybePromise<unknown>;
  buildHelpEmbed?: RegistryFunction;
  findGameAndSuggestion?: (input: string, games: GameConfig[]) => unknown;
  getFindGameCacheSize?: RegistryFunction;
  clearFindGameCache?: RegistryFunction;
  formatUserError?: (err: unknown, fallback: string, code?: string) => string;
  [key: string]: unknown;
}

type RequiredCommandRegistryKey =
  | "cleanCache"
  | "getCacheSizes"
  | "setGlobalCacheTtl"
  | "checkForUpdates"
  | "checkForDiscounts"
  | "buildOptimizedGameList"
  | "registerSlashCommands"
  | "buildSlashCommandDefinitions"
  | "handleInteraction"
  | "buildHelpEmbed"
  | "findGameAndSuggestion"
  | "getFindGameCacheSize"
  | "clearFindGameCache"
  | "formatUserError";

type RequiredCommandRegistry = {
  [K in RequiredCommandRegistryKey]: NonNullable<CommandRegistryContext[K]>;
};

const runtimeContext = require("../command-runtime/commandRuntimeContext") as CommandRegistryContext;
const defaultInstallers: CommandModuleInstaller[] = [
  require("../command-cache/commandCache") as CommandModuleInstaller,
  require("../../domain/deals/filters") as CommandModuleInstaller,
  require("../command-presentation/commandPresentation") as CommandModuleInstaller,
  require("../notifications") as CommandModuleInstaller,
  require("../command-definitions/slashCommandDefinitions") as CommandModuleInstaller,
  // V12: fallback handler pentru bottom-of-chain (redenumit din legacy router).
  // Toate handlers-urile cunoscute (ping, games, help, start, stop, set, latest,
  // dlc, status, autocomplete) sunt in module dedicate tipate care wrap
  // ctx.handleInteraction. Acest handler ruleaza doar pentru comenzi
  // necunoscute, non-chat-input fara handler, sau lipsa context guild.
  require("../command-handlers/fallbackInteractionHandler") as CommandModuleInstaller,
  // V12: /ping si /games extrase din legacy router intr-o factory tipata cu
  // o singura dependinta (COMMAND_OUTPUT_MAX_CHARS). Ultimul pas pentru
  // retragerea completa a dispatch-ului vechi.
  require("../command-handlers/simpleCommandsHandler") as CommandModuleInstaller,
  require("../command-handlers/helpInteractionHandler") as CommandModuleInstaller,
  require("../command-handlers/subscriptionNotificationHandlers") as CommandModuleInstaller,
  require("../command-handlers/gameFilterHandlers") as CommandModuleInstaller,
  require("../command-handlers/rolePingHandlers") as CommandModuleInstaller,
  // V12: /set DIRECT subs (mode/mindiscount/maxprice/free/paid/currency/stores)
  // extrase din legacy router intr-o factory tipata. Sub-comenzile cu grup
  // (`/set games X`, `/set role X`) raman in `gameFilterHandlers` /
  // `rolePingHandlers` care intercepteaza inainte sa ajunga aici. Installer-ul
  // verifica explicit `group !== "games" && !== "role"` ca sa nu intercepteze
  // gresit grupurile (defense in depth daca ordinea install se schimba).
  require("../command-handlers/setInteractionHandler") as CommandModuleInstaller,
  // V12: /latest extras din legacy router intr-o factory tipata cu deps
  // explicite (cele 4 sub-comenzi updates/reduceri/update/pret + dispatcher
  // cu guard pentru sub necunoscut). Versiunea legacy ramane shadow-ed.
  require("../command-handlers/latestInteractionHandler") as CommandModuleInstaller,
  // V11: /status si /dlc extrase din legacy router in factory-uri tipate cu
  // deps explicite, simetric cu cele patru installer-e de mai sus. Versiunile
  // legacy raman shadow-ed: aceste installer-e vin dupa legacy in chain si
  // intercepteaza interactiunile inainte sa ajunga la dispatcher-ul vechi.
  require("../command-handlers/statusInteractionHandler") as CommandModuleInstaller,
  require("../command-handlers/dlcInteractionHandler") as CommandModuleInstaller,
  // V12: autocomplete extras din legacy router. Acopera optiunile `joc` din
  // /dlc, /status, /latest update, /latest pret, /set games add/remove. Deps
  // tipate (logger, getGuildSettings) — niciun acces ctx in interior.
  require("../command-handlers/autocompleteInteractionHandler") as CommandModuleInstaller,
  require("../command-security/adminCommandRouterGuard") as CommandModuleInstaller
];

function installCommandModules(
  context: CommandRegistryContext,
  installers: CommandModuleInstaller[] = defaultInstallers
): CommandRegistryContext {
  for (const install of installers) install(context);
  return context;
}

function requireRegistryFunction<K extends RequiredCommandRegistryKey>(
  context: CommandRegistryContext,
  key: K
): RequiredCommandRegistry[K] {
  const value = context[key];
  if (typeof value !== "function") {
    throw new Error(`commandRegistry nu a primit functia necesara din ctx: ${String(key)}`);
  }
  return value as RequiredCommandRegistry[K];
}

function createCommandRegistry(
  baseContext: CommandRegistryContext = runtimeContext,
  installers: CommandModuleInstaller[] = defaultInstallers
): RequiredCommandRegistry {
  const context = installCommandModules(baseContext, installers);
  return {
    cleanCache: requireRegistryFunction(context, "cleanCache"),
    getCacheSizes: requireRegistryFunction(context, "getCacheSizes"),
    setGlobalCacheTtl: requireRegistryFunction(context, "setGlobalCacheTtl"),
    checkForUpdates: requireRegistryFunction(context, "checkForUpdates"),
    checkForDiscounts: requireRegistryFunction(context, "checkForDiscounts"),
    buildOptimizedGameList: requireRegistryFunction(context, "buildOptimizedGameList"),
    registerSlashCommands: requireRegistryFunction(context, "registerSlashCommands"),
    buildSlashCommandDefinitions: requireRegistryFunction(context, "buildSlashCommandDefinitions"),
    handleInteraction: requireRegistryFunction(context, "handleInteraction"),
    buildHelpEmbed: requireRegistryFunction(context, "buildHelpEmbed"),
    findGameAndSuggestion: requireRegistryFunction(context, "findGameAndSuggestion"),
    getFindGameCacheSize: requireRegistryFunction(context, "getFindGameCacheSize"),
    clearFindGameCache: requireRegistryFunction(context, "clearFindGameCache"),
    formatUserError: requireRegistryFunction(context, "formatUserError")
  };
}

const commands = Object.assign(createCommandRegistry(), {
  createCommandRegistry,
  installCommandModules
});

export = commands;
