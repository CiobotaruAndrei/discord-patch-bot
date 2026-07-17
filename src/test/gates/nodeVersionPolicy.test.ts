import test from "node:test";
import assert from "node:assert/strict";

import fs from "fs";
import path from "path";

const repoRoot = path.resolve(process.cwd(), "..");
const OFFICIAL_NODE_MAJOR = 24;

function read(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

test("politica oficiala Node 24.x e sincronizata: badge, cerinte README, engines, Dockerfile, CI (raport post-#699 #7 / post-#705 #9)", () => {
  const readme = read("README.md");
  assert.match(readme, /badge\/node-24\.x-/, "badge-ul README afiseaza Node 24.x");
  assert.match(readme, /Node\.js 24\.x/, "sectiunea de cerinte README indica Node.js 24.x");
  assert.doesNotMatch(readme, /badge\/node-(?!24\.x)/, "badge-ul nu ramane pe alta versiune");

  const packageJson = JSON.parse(read(path.join("src", "package.json"))) as { engines?: { node?: string } };
  assert.equal(packageJson.engines?.node, ">=24", "engines.node cere cel putin versiunea oficiala");

  const dockerfile = read("Dockerfile");
  const dockerNodeImages = dockerfile.match(/FROM node:[^\s]+/g) ?? [];
  assert.ok(dockerNodeImages.length >= 2, "Dockerfile are stage-urile de build si runtime pe imagini node");
  for (const image of dockerNodeImages) {
    assert.match(image, new RegExp(`FROM node:${OFFICIAL_NODE_MAJOR}\\b`), `stage-ul Docker '${image}' foloseste Node ${OFFICIAL_NODE_MAJOR}`);
  }

  const workflowsDir = path.join(repoRoot, ".github", "workflows");
  const workflowFiles = fs.readdirSync(workflowsDir).filter(file => file.endsWith(".yml"));
  let nodeVersionLines = 0;
  for (const file of workflowFiles) {
    const workflow = fs.readFileSync(path.join(workflowsDir, file), "utf8");
    for (const match of workflow.matchAll(/node-version:\s*['"]?(\d+)/g)) {
      nodeVersionLines++;
      assert.equal(Number(match[1]), OFFICIAL_NODE_MAJOR, `workflow-ul ${file} foloseste Node ${OFFICIAL_NODE_MAJOR}`);
    }
  }
  assert.ok(nodeVersionLines > 0, "cel putin un workflow declara node-version");
});
