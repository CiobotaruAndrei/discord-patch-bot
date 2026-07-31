import test from "node:test";
import assert from "node:assert/strict";

import { loadModule, functionNames, importedModules } from "./sourceStructureQueries.js";

const entry = loadModule("features", "command-security", "passiveArchiveInspection.ts");

const FORMAT_MODULES: ReadonlyArray<readonly [string, string]> = [
  ["pdfInspection.ts", "pdfStructuralIndicators"],
  ["ooxmlInspection.ts", "ooxmlRelationshipIndicators"],
  ["compoundFileInspection.ts", "inspectCompoundFileBinary"],
  ["rarSevenZipHeaders.ts", "scanRar5Headers"],
  ["archiveContentIndicators.ts", "contentIndicators"],
  ["archiveInspectionBudget.ts", "enforceBudget"]
];

test("fiecare format are modulul lui, cu functia care il parseaza", () => {
  for (const [file, expected] of FORMAT_MODULES) {
    const query = loadModule("features", "command-security", file);
    assert.ok(
      functionNames(query).includes(expected),
      `${file} contine ${expected}; daca dispare, parsarea formatului s-a intors in fisierul de rutare`
    );
  }
});

test("fisierul de intrare ruteaza, nu parseaza", () => {
  const own = functionNames(entry);
  const parsers = [
    "pdfStructuralIndicators",
    "ooxmlRelationshipIndicators",
    "inspectCompoundFileBinary",
    "scanRar4Headers",
    "scanRar5Headers",
    "scanSevenZipHeaders",
    "contentIndicators",
    "textLinkIndicators"
  ];
  const relapsed = parsers.filter(name => own.includes(name));
  assert.deepEqual(
    relapsed,
    [],
    "un parser intors in fisierul de rutare inseamna ca formatele se amesteca din nou intr-un singur fisier de peste 800 de linii: " +
      relapsed.join(", ")
  );
  for (const file of ["pdfInspection.ts", "compoundFileInspection.ts", "rarSevenZipHeaders.ts", "archiveContentIndicators.ts", "archiveInspectionBudget.ts"]) {
    const module = file.replace(".ts", ".js");
    assert.ok(
      importedModules(entry).some(imported => imported.endsWith(module)),
      `rutarea cere ${module} in loc sa reimplementeze formatul`
    );
  }
  const indicators = loadModule("features", "command-security", "archiveContentIndicators.ts");
  assert.ok(
    importedModules(indicators).some(module => module.endsWith("ooxmlInspection.js")),
    "OOXML se atinge prin indicatorii de continut, nu direct din rutare: relatiile OOXML se citesc doar cand intrarea e un document"
  );
});

test("bugetul de inspectie e un singur loc, folosit de toate formatele", () => {
  const budget = "archiveInspectionBudget.js";
  const users = ["pdfInspection.ts", "rarSevenZipHeaders.ts", "archiveContentIndicators.ts"];
  for (const file of users) {
    const query = loadModule("features", "command-security", file);
    assert.ok(
      importedModules(query).some(module => module.endsWith(budget)),
      `${file} foloseste bugetul comun; doua bugete paralele ar insemna doua praguri de zip bomb care pot devia`
    );
  }
});
