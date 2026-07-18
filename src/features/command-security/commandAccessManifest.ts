"use strict";

export type { CommandAccessRule, CommandAccessTier } from "../command-catalog/commandCatalog.js";
export {
  COMMAND_ACCESS_MANIFEST,
  isOwnerOnlyCommandPath,
  isRouterAdminCommandPath,
  isRuntimeAdminCommandPath,
  isConfigurableAdminCommandPath,
  isSensitiveCommandPath
} from "../command-catalog/commandCatalog.js";
