"use strict";

const { evaluateEnvPreflight, REQUIRED_ENV_VARS } = require("../shared/envPreflight") as typeof import("../shared/envPreflight");

const report = evaluateEnvPreflight(process.env);

for (const name of report.presentRequired) {
  console.log(`OK: ${name} setat`);
}
for (const warning of report.warnings) {
  console.log(`AVERTISMENT: ${warning}`);
}
if (!report.ok) {
  for (const name of report.missingRequired) {
    console.error(`LIPSA: ${name} (obligatoriu — boot-ul ar esua fail-fast)`);
  }
  console.error(`Env incomplet: ${report.missingRequired.length}/${REQUIRED_ENV_VARS.length} variabile obligatorii lipsesc. Ruleaza cu .env: node --env-file=.env dist/scripts/check-env.js`);
  process.exit(1);
}
console.log(`Env OK: toate cele ${REQUIRED_ENV_VARS.length} variabile obligatorii sunt setate.`);

export {};
