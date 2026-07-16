import type { CommandHandlerDomain } from "./commandHandlerDescriptors.js";

interface SlashProbeOption {
  type: number;
  name: string;
  options?: readonly SlashProbeOption[];
}

export interface SlashProbeDefinition {
  name: string;
  options?: readonly SlashProbeOption[];
}

export interface CommandOwnershipProbe {
  commandName: string;
  group: string | null;
  subcommand: string | null;
}

export interface CommandOwnerCandidate {
  id: string;
  domain: CommandHandlerDomain;
  canHandle(interaction: unknown): boolean;
}

const SUBCOMMAND_TYPE = 1;
const SUBCOMMAND_GROUP_TYPE = 2;

export function enumerateCommandProbes(definitions: readonly SlashProbeDefinition[]): CommandOwnershipProbe[] {
  const probes: CommandOwnershipProbe[] = [];
  for (const definition of definitions) {
    const options = definition.options ?? [];
    const subcommands = options.filter(option => option.type === SUBCOMMAND_TYPE);
    const groups = options.filter(option => option.type === SUBCOMMAND_GROUP_TYPE);
    if (subcommands.length === 0 && groups.length === 0) {
      probes.push({ commandName: definition.name, group: null, subcommand: null });
      continue;
    }
    for (const subcommand of subcommands) {
      probes.push({ commandName: definition.name, group: null, subcommand: subcommand.name });
    }
    for (const group of groups) {
      for (const subcommand of (group.options ?? []).filter(option => option.type === SUBCOMMAND_TYPE)) {
        probes.push({ commandName: definition.name, group: group.name, subcommand: subcommand.name });
      }
    }
  }
  return probes;
}

export function buildOwnershipProbeInteraction(probe: CommandOwnershipProbe): unknown {
  return {
    commandName: probe.commandName,
    isChatInputCommand: () => true,
    isAutocomplete: () => false,
    isButton: () => false,
    isModalSubmit: () => false,
    guild: { id: "ownership-probe" },
    guildId: "ownership-probe",
    options: {
      getSubcommand: () => probe.subcommand,
      getSubcommandGroup: () => probe.group,
      getString: () => null,
      getInteger: () => null,
      getNumber: () => null,
      getBoolean: () => null,
      getUser: () => null,
      getChannel: () => null,
      getRole: () => null,
      getFocused: () => ""
    }
  };
}

function probePath(probe: CommandOwnershipProbe): string {
  return [probe.commandName, probe.group, probe.subcommand]
    .filter((part): part is string => typeof part === "string")
    .join(" ");
}

export function assertExclusiveCommandOwnership(
  definitions: readonly SlashProbeDefinition[],
  owners: readonly CommandOwnerCandidate[]
): void {
  const candidates = owners.filter(owner => owner.domain !== "routing");
  for (const probe of enumerateCommandProbes(definitions)) {
    const interaction = buildOwnershipProbeInteraction(probe);
    const claimants: string[] = [];
    for (const candidate of candidates) {
      let claimed = false;
      try {
        claimed = candidate.canHandle(interaction) === true;
      } catch {
        claimed = false;
      }
      if (claimed) claimants.push(candidate.id);
    }
    if (claimants.length > 1) {
      throw new Error(`Comanda /${probePath(probe)} e revendicata de ${claimants.length} handlere (${claimants.join(", ")}); ownership-ul pe comenzi trebuie sa fie exclusiv`);
    }
    if (claimants.length === 0) {
      throw new Error(`Comanda /${probePath(probe)} nu e revendicata de niciun handler dedicat (ar cadea pe fallback)`);
    }
  }
}
