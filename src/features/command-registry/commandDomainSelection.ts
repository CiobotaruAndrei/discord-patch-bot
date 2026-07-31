"use strict";

import type { CommandDomainDeps } from "./commandDomainDeps.js";

type DomainName = keyof CommandDomainDeps;

function copyKey<T extends object, K extends keyof T>(target: Partial<Pick<T, K>>, source: T, key: K): void {
  if (key in source) target[key] = source[key];
}

function pickKeys<T extends object, K extends keyof T>(source: T, keys: readonly K[]): Pick<T, K> {
  const selected: Partial<Pick<T, K>> = {};
  for (const key of keys) copyKey(selected, source, key);
  return selected as Pick<T, K>;
}

export function selectHandlerDeps<D extends DomainName, K extends keyof CommandDomainDeps[D]>(
  context: CommandDomainDeps[D],
  needs: readonly K[]
): Pick<CommandDomainDeps[D], K> {
  return pickKeys(context, needs);
}
