# Changelog

All notable changes to this project are documented here.

The project uses semantic version tags in the form `vMAJOR.MINOR.PATCH`. After a tag is pushed, the release workflow runs the full check suite and creates a GitHub Release.

## [Unreleased]

### Added

- End-to-end test coverage for `/start updates` baseline activation through cron delivery and seen marking.
- `SECURITY.md` with private vulnerability reporting guidance.
- GitHub Actions release workflow for `v*.*.*` tags and manual release runs.
- README release/security documentation.

### Changed

- Documentation now tracks the new E2E flow, security policy and release process.

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
