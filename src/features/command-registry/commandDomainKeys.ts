"use strict";

import { createCommandHandlerDescriptors } from "./commandHandlerDescriptors.js";

import type { CommandHandlerDomain } from "./commandHandlerDescriptors.js";

export type CommandDomainKeys = Readonly<Record<CommandHandlerDomain, readonly string[]>>;

export function deriveCommandDomainKeys(): CommandDomainKeys {
  const perDomain = new Map<CommandHandlerDomain, Set<string>>();
  for (const descriptor of createCommandHandlerDescriptors()) {
    const keys = perDomain.get(descriptor.domain) ?? new Set<string>();
    for (const key of descriptor.needs) keys.add(String(key));
    perDomain.set(descriptor.domain, keys);
  }
  const derived: Partial<Record<CommandHandlerDomain, readonly string[]>> = {};
  for (const [domain, keys] of perDomain) derived[domain] = [...keys].sort();
  return derived as CommandDomainKeys;
}
