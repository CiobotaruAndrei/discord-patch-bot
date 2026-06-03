import http = require("http");
import https = require("https");

interface HealthEval { ok: boolean; problems: string[] }
interface MetricsEval { ok: boolean; missing: string[] }
interface ProbeResult { status: number; body: string }

const REQUIRED_METRICS = [
  "bot_uptime_seconds",
  "bot_fetch_success",
  "bot_outbox_queue_depth",
  "bot_native_fallback_total"
];

function evaluateHealthBody(body: unknown): HealthEval {
  const problems: string[] = [];
  const b = body && typeof body === "object" ? body as Record<string, unknown> : {};
  if (b.status !== "ok") problems.push(`status != ok (${String(b.status)})`);
  if (typeof b.uptimeMs !== "number") problems.push("uptimeMs lipseste sau nu este numar");
  if (b.discord !== "ready") problems.push(`discord != ready (${String(b.discord)})`);
  if (b.mongo !== 1) problems.push(`mongo readyState != 1 (${String(b.mongo)})`);
  return { ok: problems.length === 0, problems };
}

function evaluateMetricsText(text: string, requiredNames: string[] = REQUIRED_METRICS): MetricsEval {
  const missing = requiredNames.filter(name => !new RegExp(`(^|\\n)${name}(\\s|\\{)`).test(text));
  return { ok: missing.length === 0, missing };
}

function probe(rawUrl: string, headers: Record<string, string> = {}): Promise<ProbeResult> {
  return new Promise((resolve, reject) => {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      reject(new Error(`URL invalid: ${rawUrl}`));
      return;
    }
    const client = url.protocol === "https:" ? https : http;
    const req = client.request(url, { method: "GET", headers, timeout: 15000 }, res => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", chunk => { data += chunk; });
      res.on("end", () => resolve({ status: res.statusCode || 0, body: data }));
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(new Error("timeout dupa 15s")); });
    req.end();
  });
}

async function runStagingSmoke(): Promise<number> {
  const baseUrl = (process.env.STAGING_BASE_URL || "").trim().replace(/\/$/, "");
  if (!baseUrl) {
    console.log("[staging-smoke] STAGING_BASE_URL nu este setat - sar proba live (exit 0).");
    console.log("[staging-smoke] Seteaza STAGING_BASE_URL (si optional STAGING_METRICS_TOKEN) catre instanta de staging");
    console.log("[staging-smoke] ca acest runner sa verifice /healthz si /metrics. Comenzile/notificarile Discord live");
    console.log("[staging-smoke] raman de verificat manual conform STAGING_SMOKE.md.");
    return 0;
  }

  let failures = 0;

  try {
    const health = await probe(`${baseUrl}/healthz`);
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(health.body);
    } catch {
      parsed = null;
    }
    const evalH = evaluateHealthBody(parsed);
    if (health.status !== 200 || !evalH.ok) {
      failures++;
      console.error(`[staging-smoke] /healthz FAIL (HTTP ${health.status}): ${evalH.problems.join("; ") || "raspuns ne-JSON"}`);
    } else {
      console.log("[staging-smoke] /healthz OK (status=ok, mongo + discord ready).");
    }
  } catch (err) {
    failures++;
    console.error(`[staging-smoke] /healthz eroare de retea: ${err instanceof Error ? err.message : String(err)}`);
  }

  try {
    const token = (process.env.STAGING_METRICS_TOKEN || "").trim();
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    const metrics = await probe(`${baseUrl}/metrics`, headers);
    const evalM = evaluateMetricsText(metrics.body);
    if (metrics.status !== 200 || !evalM.ok) {
      failures++;
      console.error(`[staging-smoke] /metrics FAIL (HTTP ${metrics.status}): metrici lipsa: ${evalM.missing.join(", ") || "(niciuna; verifica auth/token)"}`);
    } else {
      console.log("[staging-smoke] /metrics OK (metrici cheie prezente).");
    }
  } catch (err) {
    failures++;
    console.error(`[staging-smoke] /metrics eroare de retea: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (failures === 0) {
    console.log("[staging-smoke] Proba live a trecut. NB: comenzile/notificarile Discord live raman de verificat manual (STAGING_SMOKE.md).");
    return 0;
  }
  console.error(`[staging-smoke] ${failures} verificare(i) esuate.`);
  return 1;
}

export { evaluateHealthBody, evaluateMetricsText, runStagingSmoke, REQUIRED_METRICS };

if (require.main === module) {
  runStagingSmoke()
    .then(code => process.exit(code))
    .catch(err => {
      console.error("[staging-smoke] eroare neasteptata:", err);
      process.exit(1);
    });
}
