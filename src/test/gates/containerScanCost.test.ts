import test from "node:test";
import assert from "node:assert/strict";

import fs from "fs";
import path from "path";

const repoRoot = path.resolve(process.cwd(), "..");
const workflow = fs.readFileSync(path.join(repoRoot, ".github", "workflows", "container-scan.yml"), "utf8");

function sectiune(deLa: string, panaLa: string): string {
  const start = workflow.indexOf(deLa);
  const end = workflow.indexOf(panaLa);
  assert.ok(start >= 0 && end > start, `nu am gasit sectiunea ${deLa} .. ${panaLa}`);
  return workflow.slice(start, end);
}

test("SARIF-ul si gate-ul impart o singura scanare, fiindca folosesc aceleasi filtre", () => {
  const scanari = workflow.match(/uses: aquasecurity\/trivy-action@/g) ?? [];
  assert.equal(
    scanari.length,
    2,
    "fiecare pornire de Trivy isi descarca din nou baza de vulnerabilitati: masurat, 14-15s de fiecare data. " +
      "SARIF-ul si gate-ul cer exact acelasi set de vulnerabilitati si difera doar prin format, deci a treia " +
      `scanare era munca dublata. Ramane si scanarea de SBOM, separata din motivul de mai jos. Gasite: ${scanari.length}`
  );

  assert.ok(
    workflow.includes("trivy convert --format sarif"),
    "SARIF-ul se obtine din raportul deja calculat, nu printr-o scanare noua"
  );
  assert.ok(
    workflow.includes("trivy convert --format table"),
    "gate-ul se obtine din acelasi raport ca SARIF-ul"
  );
});

test("SBOM-ul ramane scanare proprie, ca sa nu piarda vulnerabilitatile fara fix", () => {
  const sbom = sectiune("Generate SBOM (CycloneDX)", "Upload SBOM artifact");
  assert.ok(sbom.includes("format: cyclonedx"), "SBOM-ul se genereaza direct, in formatul lui");
  assert.ok(
    !sbom.includes("ignore-unfixed") && !sbom.includes("severity:"),
    "inventarul trebuie sa ramana complet: filtrat, si-ar pierde pachete si severitati"
  );

  const raport = sectiune("Trivy scan (fixabile", "Converteste raportul in SARIF");
  assert.ok(
    raport.includes("ignore-unfixed: true"),
    "`trivy convert` accepta `--severity` dar NU are `--ignore-unfixed` (verificat pe 0.72.0), deci filtrul " +
      "asta trebuie sa ramana pe scanare. De aceea SBOM-ul nu poate iesi din acelasi raport"
  );
  assert.ok(
    raport.includes("list-all-pkgs: true"),
    "fara lista completa de pachete raportul nu poate fi convertit corect"
  );
});

test("pragurile de blocare nu s-au pierdut la refactorizare", () => {
  const gate = workflow.slice(workflow.indexOf("Trivy gate"));
  for (const bucata of ["--severity CRITICAL,HIGH", "--exit-code 1"]) {
    assert.ok(gate.includes(bucata), `gate-ul si-a pierdut ${bucata}; ar raporta verde fara sa mai blocheze nimic`);
  }

  const sarif = sectiune("Converteste raportul in SARIF", "Upload Trivy SARIF");
  assert.ok(
    sarif.includes("--severity CRITICAL,HIGH"),
    "SARIF-ul urcat in code scanning trebuie sa pastreze aceleasi praguri ca inainte"
  );
});

test("rularea programata isi pastreaza build-ul fara cache, iar exportul e comprimat cu zstd", () => {
  assert.ok(
    workflow.includes("no-cache: ${{ github.event_name == 'schedule' }}"),
    "rularea saptamanala exista ca sa prinda CVE-uri noi in imaginea de baza; cu layere din cache, " +
      "`apt-get upgrade` nu s-ar mai executa si Trivy ar scana o imagine veche"
  );
  assert.ok(
    workflow.includes("cache-to: type=gha,mode=max,compression=zstd"),
    "exportul de cache e al doilea cost al jobului dupa compilarea librariilor C: masurat, 119s cand stratul " +
      "de dependinte cargo s-a reconstruit si 18s cand totul venea din cache. zstd comprima acelasi continut " +
      "mai repede decat gzip, iar `mode=max` ramane, altfel straturile intermediare nu s-ar mai refolosi"
  );
});
