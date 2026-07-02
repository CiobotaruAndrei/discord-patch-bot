"use strict";

type Logger = (level: string, context: string, message: string, meta?: unknown) => void;
type AdminAlert = (kind: string, title: string, body: string, guildId?: string) => Promise<unknown>;
type ErrorFormatter = (err: unknown) => string;

export interface DatabaseStartupDeps {
  connectMongo(): Promise<void>;
  waitForMongoReady(timeoutMs?: number): Promise<boolean>;
  runMigrations(logger: unknown): Promise<{ applied: number[] }>;
  migrationsContinueOnError: boolean;
  logger: Logger;
  adminAlert: AdminAlert;
  errorMessage: ErrorFormatter;
  errorDetail: ErrorFormatter;
}

export async function runDatabaseStartupPhase(deps: DatabaseStartupDeps): Promise<void> {
  const { connectMongo, waitForMongoReady, runMigrations, migrationsContinueOnError, logger, adminAlert, errorMessage, errorDetail } = deps;
  await connectMongo();
  const mongoReady = await waitForMongoReady(10000);
  if (!mongoReady) {
    logger("WARN", "BOOT", "Mongo nu a confirmat conexiunea in timp util");
  }
  try {
    const migrations = await runMigrations(logger);
    if (migrations.applied.length) {
      logger("INFO", "MIGRATE", `Migrari aplicate: ${migrations.applied.join(", ")}`);
    }
  } catch (migErr) {
    if (!migrationsContinueOnError) {
      logger("ERROR", "MIGRATE", "Migrari esuate la boot — opresc pornirea (fail-fast pentru integritatea schemei; seteaza MIGRATIONS_CONTINUE_ON_ERROR=true ca sa pornesti oricum, pe propriul risc)", errorDetail(migErr));
      throw migErr;
    }
    logger("ERROR", "MIGRATE", "Migrari esuate la boot — continui fara ele (MIGRATIONS_CONTINUE_ON_ERROR=true; risc de schema inconsistenta, retry la urmatorul restart)", errorDetail(migErr));
    adminAlert("boot:migrations", "Migrari DB esuate la pornire (pornit oricum)", errorMessage(migErr)).catch(() => null);
  }
}

export interface CacheHydrationDeps {
  hydrateCaches(): Promise<void>;
  logger: Logger;
  errorMessage: ErrorFormatter;
}

export async function runCacheHydrationPhase(deps: CacheHydrationDeps): Promise<void> {
  try {
    await deps.hydrateCaches();
  } catch (hydrateErr) {
    deps.logger("WARN", "BOOT", "Hidratarea cache-ului din snapshot a esuat", deps.errorMessage(hydrateErr));
  }
}

export interface HttpStartupDeps {
  httpServer: {
    on(event: "error", listener: (err: Error) => void): unknown;
    listen(port: number | string, callback?: () => void): unknown;
  };
  port: number | string;
  logger: Logger;
  adminAlert: AdminAlert;
  errorMessage: ErrorFormatter;
  errorDetail: ErrorFormatter;
}

export function runHttpStartupPhase(deps: HttpStartupDeps): void {
  const { httpServer, port, logger, adminAlert, errorMessage, errorDetail } = deps;
  httpServer.on("error", (err: Error) => {
    logger("ERROR", "HTTP", `httpServer error (port=${port})`, errorDetail(err));
    adminAlert("http:listen", "Eroare HTTP server", errorMessage(err)).catch(() => null);
  });
  httpServer.listen(port, () => {
    logger("INFO", "HTTP", `Health/metrics server pornit pe port ${port}`);
  });
}

export interface DiscordStartupDeps {
  client: { login(token: string): Promise<unknown> };
  token: string;
}

export async function runDiscordStartupPhase(deps: DiscordStartupDeps): Promise<void> {
  await deps.client.login(deps.token);
}
