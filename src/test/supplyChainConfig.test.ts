import test from "node:test";
import assert from "node:assert/strict";

const fs = require("fs") as typeof import("fs");
const path = require("path") as typeof import("path");

const srcRoot = process.cwd();
const repoRoot = path.resolve(srcRoot, "..");
const dependabotPath = path.join(repoRoot, ".github", "dependabot.yml");
const dependencyReviewPath = path.join(repoRoot, ".github", "workflows", "dependency-review.yml");
const securityPath = path.join(repoRoot, "SECURITY.md");

function read(file: string): string {
  return fs.readFileSync(file, "utf8");
}

test("dependabot acopera npm, github-actions si cargo (crate-ul Rust)", () => {
  const text = read(dependabotPath);
  assert.match(text, /package-ecosystem:\s*"npm"/, "ecosistem npm");
  assert.match(text, /package-ecosystem:\s*"github-actions"/, "ecosistem github-actions");
  assert.match(text, /package-ecosystem:\s*"cargo"/, "ecosistem cargo (Rust)");
  assert.match(text, /directory:\s*"\/src\/native"/, "cargo pointeaza catre crate-ul Rust din /src/native");
});

test("toate actions din workflow-uri sunt pinuite pe commit SHA (supply chain: tag-urile sunt mutabile)", () => {
  const workflowsDir = path.join(repoRoot, ".github", "workflows");
  const offenders: string[] = [];
  for (const file of fs.readdirSync(workflowsDir).filter((f: string) => f.endsWith(".yml"))) {
    const text = read(path.join(workflowsDir, file));
    for (const rawLine of text.split(String.fromCharCode(10))) {
      const line = rawLine.replace(String.fromCharCode(13), String());
      const match = line.match(/uses:\s*([^\s]+)/);
      if (!match) continue;
      const ref = match[1];
      if (ref.startsWith("./")) continue;
      if (!/@[0-9a-f]{40}$/.test(ref)) offenders.push(`${file}: ${ref}`);
    }
  }
  assert.deepEqual(offenders, [], "fiecare uses: extern trebuie pinuit pe SHA de commit (Dependabot github-actions le actualizeaza controlat)");
});

test("dependency-review ruleaza actiunea blocking neconditionat (fail-closed real)", () => {
  const text = read(dependencyReviewPath);
  assert.match(text, /actions\/dependency-review-action@[0-9a-f]{40}/, "foloseste dependency-review-action pinuita pe SHA");
  assert.match(text, /fail-on-severity:\s*moderate/, "blocheaza la severitate moderate+");
  assert.ok(!/dependency-graph\b/.test(text) && !/dependency_graph\?\.status/.test(text), "fara gate pe statusul dependency graph (nesigur pe repo-uri publice, unde graph-ul e mereu activat dar API-ul intoarce undefined - masca faptul ca actiunea nu rula niciodata)");
  assert.ok(!/if:\s/.test(text), "actiunea ruleaza neconditionat (fara `if:` care ar putea-o sari -> verde fals)");
  assert.ok(!/^\s*paths:/m.test(text), "ruleaza pe toate PR-urile catre main (fara filtru paths), deci e requireable ca status check");
});

test("scripturile de staging smoke nu mai raporteaza verde la skip fara opt-out explicit", () => {
  const httpSmoke = read(path.join(repoRoot, "src", "scripts", "stagingSmoke.ts"));
  const discordSmoke = read(path.join(repoRoot, "src", "scripts", "stagingDiscordSmoke.ts"));
  for (const text of [httpSmoke, discordSmoke]) {
    assert.match(text, /ALLOW_STAGING_SMOKE_SKIP/, "skip-ul cere ALLOW_STAGING_SMOKE_SKIP=true");
    assert.match(text, /return 1/, "fara opt-out, lipsa secretelor inseamna esec (exit non-zero), nu verde fals");
  }
});

test("SECURITY.md documenteaza setarile de repo de securitate (confirmate enabled)", () => {
  const text = read(securityPath);
  assert.match(text, /Dependency graph/, "documenteaza dependency graph");
  assert.match(text, /Dependabot security updates/, "documenteaza Dependabot security updates");
  assert.match(text, /required status checks/i, "documenteaza required status checks in branch protection");
  assert.match(text, /Dependency Review/, "documenteaza Dependency Review ca status check pe fiecare PR");
});

test("dependency-audit pinuieste versiunea cargo-audit (instalarea live flotanta poate schimba rezultatul intre rulari)", () => {
  const text = read(path.join(repoRoot, ".github", "workflows", "dependency-audit.yml"));
  assert.match(text, /cargo install cargo-audit --locked --version \d+\.\d+\.\d+/, "cargo-audit instalat cu versiune fixata");
});

test("Dockerfile nu instaleaza rustup prin curl | sh; toolchain-ul vine din imaginea oficiala rust, sincronizata cu rust-toolchain.toml", () => {
  const dockerfile = read(path.join(repoRoot, "Dockerfile"));
  assert.ok(!dockerfile.includes("sh.rustup.rs"), "fara script remote executat direct (curl | sh) pentru rustup");
  assert.ok(!/curl[^\n]*\|\s*sh/.test(dockerfile), "niciun curl | sh in Dockerfile");
  const imageMatch = dockerfile.match(/FROM rust:(\d+\.\d+\.\d+)-slim-bookworm AS rust-toolchain/);
  assert.ok(imageMatch, "toolchain-ul Rust vine dintr-un stage FROM rust:<versiune>-slim-bookworm");
  assert.match(dockerfile, /COPY --from=rust-toolchain \/usr\/local\/rustup \/usr\/local\/rustup/, "copiaza rustup din imaginea oficiala");
  assert.match(dockerfile, /COPY --from=rust-toolchain \/usr\/local\/cargo \/usr\/local\/cargo/, "copiaza cargo din imaginea oficiala");
  const toolchainToml = read(path.join(repoRoot, "src", "native", "rust-toolchain.toml"));
  const channelMatch = toolchainToml.match(/channel = "(\d+\.\d+\.\d+)"/);
  assert.ok(channelMatch, "rust-toolchain.toml are channel pinuit");
  assert.equal(imageMatch![1], channelMatch![1],
    "versiunea imaginii rust din Dockerfile trebuie sa ramana sincronizata cu channel-ul din rust-toolchain.toml");
});

test("package.json pinuieste prin overrides versiunile patch-uite ale dep-urilor tranzitive cu CVE (form-data, ws)", () => {
  const pkg = JSON.parse(read(path.join(srcRoot, "package.json"))) as { overrides?: Record<string, string> };
  assert.ok(pkg.overrides, "exista un camp overrides pentru pin-urile de securitate ale dep-urilor tranzitive");
  assert.match(String(pkg.overrides?.["form-data"]), />=\s*4\.0\.6/, "form-data pinuit la >=4.0.6 (CVE-2026-12143)");
  assert.match(String(pkg.overrides?.["ws"]), />=\s*8\.21\.0/, "ws pinuit la >=8.21.0 (CVE-2026-48779, DoS prin fragmente mici)");
});
