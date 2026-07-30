"use strict";

import { COMMAND_DOMAIN_KEYS } from "./commandDomainKeys.js";
import type { CommandDomainDeps } from "./commandDomainDeps.js";

type DomainName = keyof CommandDomainDeps;

function keysFor(domain: DomainName): readonly PropertyKey[] {
  return COMMAND_DOMAIN_KEYS[domain];
}

function readableContext<D extends DomainName>(context: CommandDomainDeps[D]): Record<string, unknown> & CommandDomainDeps[D] {
  return context as Record<string, unknown> & CommandDomainDeps[D];
}

export function selectHandlerDeps<D extends DomainName>(
  context: CommandDomainDeps[D],
  needs: readonly (keyof CommandDomainDeps[D])[]
): CommandDomainDeps[D] {
  const source = readableContext<D>(context);
  const selected: Record<string, unknown> = {};
  for (const key of needs) {
    const name = String(key);
    if (name in source) selected[name] = source[name];
  }
  return selected as Record<string, unknown> & CommandDomainDeps[D];
}

export function selectDomainDeps<D extends DomainName>(domain: D, context: CommandDomainDeps[D]): CommandDomainDeps[D] {
  const source = readableContext<D>(context);
  const selected: Record<string, unknown> = {};
  for (const key of keysFor(domain)) {
    const name = String(key);
    if (name in source) selected[name] = source[name];
  }
  return selected as Record<string, unknown> & CommandDomainDeps[D];
}
