import type { MissingDependencyKeys, ExtraDependencyKeys, ExactDependencyKeys } from "../../shared/dependencyKeyContract.js";
import type { SecurityDeps } from "./securityInteractionContracts.js";
export const SECURITY_HANDLER_KEYS = [
  "OperationJournalModel",
  "ChannelLockRecoveryModel",
  "GuildModel",
  "GuildSecurityModel",
  "NewAccountAlertDeliveryModel",
  "PermissionRequestModel",
  "RaidIncidentModel",
  "AdRequestModel",
  "AdAttemptModel",
  "checkChannelPermissions",
  "formatUserError",
  "getGuildSettings",
  "logger",
  "safeDefer",
  "safeEdit"
] as const;

type SecurityKeyCheckDeps = SecurityDeps;
type SecurityMissing = MissingDependencyKeys<SecurityKeyCheckDeps, (typeof SECURITY_HANDLER_KEYS)[number] & string>;
type SecurityExtra = ExtraDependencyKeys<SecurityKeyCheckDeps, (typeof SECURITY_HANDLER_KEYS)[number] & string>;
const securityKeysComplete: ExactDependencyKeys<SecurityMissing, SecurityExtra> = true;
