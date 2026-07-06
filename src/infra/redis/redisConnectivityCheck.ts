const { errorMessage } = require("../../shared/errors") as typeof import("../../shared/errors");

interface RedisConnectivityRuntime {
  readonly enabled: boolean;
  getClient(): { ping(): Promise<unknown> } | null;
  connect(): Promise<void>;
  close(): Promise<void>;
}

type RedisConnectivityStatus = "disabled" | "ok" | "failed";

interface RedisConnectivityResult {
  status: RedisConnectivityStatus;
  ok: boolean;
  message: string;
}

async function runRedisConnectivityCheck(runtime: RedisConnectivityRuntime): Promise<RedisConnectivityResult> {
  if (!runtime.enabled) {
    return { status: "disabled", ok: true, message: "REDIS_URL nu e setat — Redis dezactivat, nimic de verificat." };
  }
  try {
    await runtime.connect();
    const client = runtime.getClient();
    if (!client) {
      return { status: "failed", ok: false, message: "Client Redis indisponibil dupa connect()." };
    }
    const pong = await client.ping();
    return { status: "ok", ok: true, message: `Redis conectat, PING -> ${String(pong)}.` };
  } catch (err) {
    return { status: "failed", ok: false, message: `Conexiune Redis esuata: ${errorMessage(err)}` };
  } finally {
    await runtime.close().catch(() => undefined);
  }
}

export { runRedisConnectivityCheck };
export type { RedisConnectivityRuntime, RedisConnectivityResult, RedisConnectivityStatus };
