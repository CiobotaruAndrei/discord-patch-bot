# Changelog

All notable changes to this project are documented here.

The project uses semantic version tags in the form `vMAJOR.MINOR.PATCH`. After a tag is pushed, the release workflow runs the full check suite, publishes the Docker image to GitHub Container Registry and creates a GitHub Release.

## [Unreleased]

### Added

- End-to-end test coverage for `/start updates` baseline activation through cron delivery and seen marking.
- End-to-end test coverage for `/start reduceri` baseline activation through cron discount delivery and `seenDiscounts` marking.
- Functional test coverage for the source registry factory with mocked installers.
- Functional test coverage for the subscription interaction factory and wrapper.
- Functional test coverage for the game filter interaction factory and wrapper.
- Functional test coverage for the role ping interaction factory and wrapper.
- Functional test coverage for the extracted `/help` handler and wrapper.
- Runtime admin guard coverage for `/start`, `/stop` and `/set`, so Discord command permissions are backed by a handler-level check.
- Release notes extraction script so GitHub Releases use the matching changelog section instead of the full changelog file.
- `SECURITY.md` with private vulnerability reporting guidance, CodeQL notes, dependency review discipline and secret scanning/push protection guidance.
- GitHub Actions CodeQL workflow for JavaScript/TypeScript security analysis.
- GitHub Actions Dependency Review workflow for pull request dependency changes, strict when GitHub Dependency graph is enabled.
- Local `npm run check:dependencies` policy check for pinned runtime/build dependencies and trusted lockfile registry URLs.
- GitHub Actions release workflow for `v*.*.*` tags and manual release runs.
- GHCR Docker image publishing from the release workflow as `ghcr.io/ciobotaruandrei/discord-patch-bot:<tag>` and `latest`.
- README release/security/dependency documentation.

### Changed

- Command code is now grouped by function under `src/features/command-registry`, `command-runtime`, `command-cache`, `command-presentation`, `command-definitions`, `command-handlers`, `command-security` and `command-router`, instead of keeping command files flat in one folder.
- The remaining legacy slash/autocomplete router now lives directly in `src/features/command-router/legacyInteractionRouter.ts`; the old `src/features/commands/` source folder is no longer needed.
- `src/test/commands-regression.test.ts` now reads built command files from the organized `dist/features` tree, so regression guards follow the functional folder layout.
- `src/features/command-handlers/helpInteractionHandler.ts` now owns `/help` through a small typed handler with explicit dependencies, installed by `commandRegistry` as another incremental extraction from `interactions.ts`.
- `src/features/command-security/adminCommandRouterGuard.ts` now wraps admin-only commands at runtime and rejects non-admin users before delegating to `/start`, `/stop` or `/set` handlers.
- `src/features/command-definitions/slashCommandDefinitions.ts` is part of the strict TypeScript slice and no longer relies on broad `any` types for Discord command builder callbacks.
- `Dockerfile` now switches the runtime image to the built-in non-root `node` user after ownership is assigned to `/app`.
- `.github/workflows/release.yml` now generates `release-notes.md` from the matching `CHANGELOG.md` section before creating the GitHub Release.
- `src/features/command-handlers/rolePingHandlers.ts` now owns `/set role updates/discounts` through a typed factory with explicit dependencies, installed by `commandRegistry` as a runtime wrapper over the legacy interaction handler.
- `src/features/command-handlers/gameFilterHandlers.ts` now owns `/set games` add/remove/list/reset through a typed factory with explicit dependencies, installed by `commandRegistry` as a runtime wrapper over the legacy interaction handler.
- `src/features/command-handlers/subscriptionNotificationHandlers.ts` now owns the `/start` and `/stop` subscription flows through a typed factory with explicit dependencies, installed by `commandRegistry` as a runtime wrapper over the legacy interaction handler.
- `src/scripts/check-dependencies.ts` now validates direct `devDependencies` as build-time supply-chain inputs, not only runtime dependencies.
- `@napi-rs/cli` is pinned exactly in `src/package.json` so the Rust/N-API build tool does not float by range.
- `src/sources/sourceRegistry.ts` now exposes `createSourceRegistry(baseContext, installers)` so source wiring can be tested and migrated away from implicit `ctx` setup gradually.
- `src/.env.example` now documents the important required and optional environment variables by category.
- Documentation now tracks the organized command folders, E2E flows, source registry factory, subscription interaction factory, game filter interaction factory, role ping interaction factory, help handler, runtime admin guard, dependency review workflow, dependency policy check, security policy, CodeQL, secret scanning guidance, release process and GHCR image publishing.

## [1.0.0] - 2026-05-21

### Added

- Discord slash commands for update notifications, discount alerts, Steam prices, DLC lookup, game status, guild settings and help.
- TypeScript source under `src/` with strict project settings and an incremental strict-check file for stabilized modules.
- Rust/N-API helper module for pure fuzzy matching, normalization, scoring and hashing paths, with TypeScript fallback.
- MongoDB models, migrations, distributed cron lock, health checks and Prometheus-style metrics.
- Dockerfile and Docker Compose setup for bot + MongoDB.
- CI workflow, dependency audit workflow, Dependabot configuration and npm lockfile.
- Functional tests for command registry, deal filters, Mongo migrations, HTTP safety, housekeeping, cron controller, outbound channel resolution and `/set games`.
- MIT license and README badges.
