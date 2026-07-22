import test from "node:test";
import assert from "node:assert/strict";

import fs from "fs";
import path from "path";

const srcRoot = process.cwd();
const repoRoot = path.resolve(srcRoot, "..");
const ciPath = path.join(repoRoot, ".github", "workflows", "ci.yml");
const windowsPath = path.join(repoRoot, ".github", "workflows", "windows-native.yml");

function readWorkflow(file: string): string {
  return fs.readFileSync(file, "utf8");
}

test("build-ul nativ e testat pe Linux la fiecare PR, cu cache pentru componentele C/C++", () => {
  const ci = readWorkflow(ciPath);
  assert.match(ci, /npm run check:native/, "clippy + testele cargo ruleaza in gate-ul de PR");
  assert.match(ci, /Swatinem\/rust-cache/, "fara cache, libyara/libarchive/qpdf se recompileaza din surse la fiecare rulare");
  assert.match(ci, /workspaces: src\/native/, "cache-ul tinteste workspace-ul nativ, nu radacina");
});

test("build-ul nativ e testat separat pe Windows, cu ambele cache-uri C/C++", () => {
  const windows = readWorkflow(windowsPath);
  assert.match(windows, /runs-on: windows-latest/, "jobul ruleaza chiar pe Windows");
  assert.match(windows, /Cache vcpkg packages/, "bibliotecile de compresie vcpkg au cache propriu");
  assert.match(windows, /vcpkg-x64-windows-[a-z0-9-]+/, "cheia cache-ului vcpkg include lista de pachete, ca o schimbare sa invalideze corect");
  assert.match(windows, /Swatinem\/rust-cache/, "librariile C compilate din surse de cargo au cache");
  assert.match(windows, /workspaces: src\/native/, "cache-ul rust tinteste workspace-ul nativ");
});

test("jobul Windows valideaza exact ce e specific platformei: clippy, build si incarcarea addonului", () => {
  const windows = readWorkflow(windowsPath);
  assert.match(windows, /npm run check:native/, "clippy -D warnings + testele cargo ruleaza si pe Windows");
  assert.match(windows, /npm run build:rust/, "addonul napi se compileaza pe Windows");
  assert.match(windows, /isRustFuzzyAvailable/, "addonul compilat chiar se incarca in Node, nu doar se linkeaza");
  assert.match(windows, /zlib\.lib/, "capcana z.lib vs zlib.lib de pe Windows ramane tratata");
});

test("descarcarea surselor vcpkg are retry, fiindca un singur esec de retea pica altfel tot jobul", () => {
  const windows = readWorkflow(windowsPath);
  assert.match(windows, /\$attempts = 3/, "instalarea vcpkg se reincearca de 3 ori");
  assert.match(windows, /Start-Sleep/, "reincercarile au pauza intre ele, nu lovesc imediat acelasi endpoint");
  assert.match(windows, /cache-hit != 'true'/, "instalarea ruleaza doar la cache miss");
});

test("jobul Windows nu e gate de PR: ruleaza nightly, la push pe main pe suprafata nativa si manual", () => {
  const windows = readWorkflow(windowsPath);
  assert.match(windows, /workflow_dispatch:/, "poate fi pornit manual");
  assert.match(windows, /schedule:/, "ruleaza programat");
  assert.match(windows, /branches:\s*\n\s*- main/, "push-ul e limitat la main");
  assert.match(windows, /src\/native\/\*\*/, "push-ul e filtrat pe suprafata nativa");
  assert.doesNotMatch(windows, /^\s{2}pull_request:/m, "compilarea C/C++ pe Windows depaseste bugetul de ~2 minute al unui PR");
});
