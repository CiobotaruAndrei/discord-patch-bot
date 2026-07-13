import fs from "node:fs";
import path from "node:path";

type DependencyField = "dependencies" | "devDependencies";

type PackageJson = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

type LockPackage = {
  version?: string;
  resolved?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

type PackageLock = {
  lockfileVersion?: number;
  packages?: Record<string, LockPackage>;
};

function readJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function fail(message: string): never {
  throw new Error(`Dependency policy failed: ${message}`);
}

function exactVersionFromSpec(spec: string) {
  const exactSemver = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
  if (exactSemver.test(spec)) return spec;
  if (!spec.startsWith("npm:")) return undefined;
  const separator = spec.lastIndexOf("@");
  const version = separator > 4 ? spec.slice(separator + 1) : "";
  return exactSemver.test(version) ? version : undefined;
}

function assertTrustedResolvedUrl(packageName: string, resolved: string | undefined) {
  if (!resolved) return;
  let parsed: URL;
  try {
    parsed = new URL(resolved);
  } catch {
    fail(`${packageName} has an invalid resolved URL in package-lock.json`);
  }
  if (parsed.protocol !== "https:") {
    fail(`${packageName} is resolved over ${parsed.protocol}, expected https:`);
  }
  if (parsed.hostname !== "registry.npmjs.org") {
    fail(`${packageName} is resolved from ${parsed.hostname}, expected registry.npmjs.org`);
  }
}

function assertDirectDependencies(
  label: string,
  field: DependencyField,
  packageDeps: Record<string, string>,
  lockRoot: LockPackage,
  packageLock: PackageLock
) {
  const lockRootDeps = lockRoot[field] || {};
  for (const [name, spec] of Object.entries(packageDeps)) {
    const version = exactVersionFromSpec(spec);
    if (!version) {
      fail(`${label} dependency ${name} must be pinned to an exact version, got ${spec}`);
    }
    if (!lockRootDeps[name]) {
      fail(`${label} dependency ${name} is missing from package-lock.json root ${field}`);
    }
    const lockEntry = packageLock.packages?.[`node_modules/${name}`];
    if (!lockEntry) {
      fail(`${label} dependency ${name} is missing from package-lock.json`);
    }
    if (lockEntry.version !== version) {
      fail(`${label} dependency ${name} resolves to ${lockEntry.version || "missing"}, expected ${version}`);
    }
    assertTrustedResolvedUrl(name, lockEntry.resolved);
  }
}

const rootDir = process.cwd();
const packageJson = readJson<PackageJson>(path.join(rootDir, "package.json"));
const packageLock = readJson<PackageLock>(path.join(rootDir, "package-lock.json"));
const lockRoot = packageLock.packages?.[""];

if (!packageLock.packages || !lockRoot) {
  fail("package-lock.json must use the npm lockfile package map");
}

if (typeof packageLock.lockfileVersion !== "number" || packageLock.lockfileVersion < 3) {
  fail("package-lock.json must be lockfileVersion 3 or newer");
}

const runtimeDependencies = packageJson.dependencies || {};
const developmentDependencies = packageJson.devDependencies || {};

assertDirectDependencies("runtime", "dependencies", runtimeDependencies, lockRoot, packageLock);
assertDirectDependencies("development", "devDependencies", developmentDependencies, lockRoot, packageLock);

for (const [packagePath, lockEntry] of Object.entries(packageLock.packages)) {
  if (!packagePath || !lockEntry.resolved) continue;
  assertTrustedResolvedUrl(packagePath.replace(/^node_modules\//, ""), lockEntry.resolved);
}

console.log(
  `Dependency policy OK: ${Object.keys(runtimeDependencies).length} runtime and ${Object.keys(developmentDependencies).length} development dependencies pinned; lockfile URLs verified.`
);
