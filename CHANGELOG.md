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
- `SECURITY.md` with private vulnerability reporting guidance, CodeQL notes, dependency review discipline and secret scanning/push protection guidance.
- GitHub Actions CodeQL workflow for JavaScript/TypeScript security analysis.
- GitHub Actions Dependency Review workflow for pull request dependency changes.
- Local `npm run check:dependencies` policy check for pinned runtime dependencies and trusted lockfile registry URLs.
- GitHub Actions release workflow for `v*.*.*` tags and manual release runs.
- GHCR Docker image publishing from the release workflow as `ghcr.io/ciobotaruandrei/discord-patch-bot:<tag>` and `latest`.
- README release/security/dependency documentation.

### Changed

- `src/features/commands/gameFilterInteractions.ts` now owns `/set games` add/remove/list/reset through a typed factory with explicit dependencies, installed by `commandRegistry` as a runtime wrapper over the legacy interaction handler.
- `src/features/commands/subscriptionInteractions.ts` now owns the `/start` and `/stop` subscription flows through a typed factory with explicit dependencies, installed by `commandRegistry` as a runtime wrapper over the legacy interaction handler.
- `src/sources/sourceRegistry.ts` now exposes `createSourceRegistry(baseContext, installers)` so source wiring can be tested and migrated away from implicit `ctx` setup gradually.
- `src/.env.example` now documents the important required and optional environment variables by category.
- Documentation now tracks the E2E flows, source registry factory, subscription interaction factory, game filter interaction factory, dependency review workflow, dependency policy check, security policy, CodeQL, secret scanning guidance, release process and GHCR image publishing.

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
