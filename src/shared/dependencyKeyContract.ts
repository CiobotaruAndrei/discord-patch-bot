export type MissingDependencyKeys<Deps, Listed extends string> = Exclude<Extract<keyof Deps, string>, Listed>;
export type ExtraDependencyKeys<Deps, Listed extends string> = Exclude<Listed, Extract<keyof Deps, string>>;
export type ExactDependencyKeys<Absente, Straine> = [Absente] extends [never]
  ? ([Straine] extends [never] ? true : ["chei in plus", Straine])
  : ["chei lipsa", Absente];

export function pickDeclaredKeys<T extends object, K extends keyof T>(source: T, keys: readonly K[]): Pick<T, K> {
  const selected: Partial<Pick<T, K>> = {};
  for (const key of keys) {
    if (key in source) selected[key] = source[key];
  }
  return selected as Pick<T, K>;
}
