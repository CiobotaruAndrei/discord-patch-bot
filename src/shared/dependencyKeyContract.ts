export type MissingDependencyKeys<Deps, Listed extends string> = Exclude<Extract<keyof Deps, string>, Listed>;
export type ExtraDependencyKeys<Deps, Listed extends string> = Exclude<Listed, Extract<keyof Deps, string>>;
export type ExactDependencyKeys<Absente, Straine> = [Absente] extends [never]
  ? ([Straine] extends [never] ? true : ["chei in plus", Straine])
  : ["chei lipsa", Absente];
