import test from "node:test";
import assert from "node:assert/strict";

import { COMMAND_CATALOG_HELP } from "../features/command-catalog/commandCatalog";
import { renderCommandReferenceDoc, COMMAND_REFERENCE_DOC_RELATIVE_PATH } from "../features/command-catalog/commandReferenceDoc";
import { evaluateCommandReferenceDoc } from "../scripts/generate-command-reference";

const fs = require("fs") as typeof import("fs");
const path = require("path") as typeof import("path");

function normalize(value: string): string {
  return value.replace(/\r\n/g, "\n");
}

test("renderCommandReferenceDoc este determinist si acopera fiecare intrare din catalog", () => {
  const first = renderCommandReferenceDoc();
  const second = renderCommandReferenceDoc();
  assert.equal(first, second);

  const rows = first.split("\n").filter(line => line.startsWith("| `/"));
  assert.equal(rows.length, COMMAND_CATALOG_HELP.length);
  for (const entry of COMMAND_CATALOG_HELP) {
    assert.ok(first.includes(`| \`${entry.command}\` |`), `randul pentru ${entry.command} lipseste din referinta generata`);
  }
});

test("renderCommandReferenceDoc pastreaza structura de tabel: fiecare rand are 4 coloane, fara pipe-uri neescapate", () => {
  const rows = renderCommandReferenceDoc().split("\n").filter(line => line.startsWith("| `/"));
  for (const row of rows) {
    const unescapedPipes = row.replace(/\\\|/g, "").split("|").length - 1;
    assert.equal(unescapedPipes, 5, `randul nu are exact 4 coloane (5 delimitatori): ${row}`);
  }
});

test("referinta include eticheta de permisiuni derivata pentru comenzi admin/owner-only", () => {
  const doc = renderCommandReferenceDoc();
  assert.ok(doc.includes("| `/health` | Admin, Ephemeral |"));
  assert.ok(doc.includes("| `/set admin-command-access` | Admin top-level, owner-only runtime, Ephemeral |"));
  assert.ok(doc.includes("| `/ping` | Public |"));
});

test("evaluateCommandReferenceDoc detecteaza lipsa, drift si sincronizare (ignorand CRLF)", () => {
  const rendered = renderCommandReferenceDoc();
  assert.deepEqual(evaluateCommandReferenceDoc(null, rendered), { inSync: false, missing: true });
  assert.deepEqual(evaluateCommandReferenceDoc(rendered + "drift", rendered), { inSync: false, missing: false });
  assert.deepEqual(evaluateCommandReferenceDoc(rendered, rendered), { inSync: true, missing: false });
  assert.deepEqual(evaluateCommandReferenceDoc(rendered.replace(/\n/g, "\r\n"), rendered), { inSync: true, missing: false });
});

test("docs/Referinta Comenzi.md comis este sincronizat cu catalogul (anti-drift)", () => {
  const repoRoot = path.resolve(process.cwd(), "..");
  const committed = fs.readFileSync(path.join(repoRoot, COMMAND_REFERENCE_DOC_RELATIVE_PATH), "utf8");
  assert.equal(
    normalize(committed),
    normalize(renderCommandReferenceDoc()),
    "docs/Referinta Comenzi.md a divergat de COMMAND_CATALOG_HELP; ruleaza 'npm run docs:commands'"
  );
});
