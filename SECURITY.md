# Security Policy

## Supported Versions

Security fixes target the latest `main` branch and the latest published GitHub Release.

## Reporting a Vulnerability

Please do not open public issues for vulnerabilities or secret leaks. This includes Discord token exposure, MongoDB credential exposure, SSRF or unsafe external URL handling, Discord permission bypasses, webhook leaks, proxy URL leaks, metrics endpoint exposure and suspicious dependency changes.

Report vulnerabilities privately through GitHub Security Advisories:

https://github.com/CiobotaruAndrei/discord-patch-bot/security/advisories/new

Please include:

- affected feature and expected impact;
- steps to reproduce;
- relevant configuration with real secrets removed;
- logs or screenshots with tokens, URLs and credentials redacted;
- whether the issue affects local Docker, production deployment, or both.

I will try to acknowledge valid reports within 72 hours. Confirmed issues should be fixed on a private branch or security advisory first, then released with a changelog note.

## Security Checks

The repository runs CodeQL for JavaScript/TypeScript through `.github/workflows/codeql.yml` on pull requests, pushes to `main`, a weekly schedule and manual runs. CodeQL complements the existing CI and dependency audit workflows; it is not a replacement for reviewing Discord, MongoDB, HTTP and proxy-related changes carefully.

Dependency safety is checked in three layers:

- `npm run check:dependencies` verifies that runtime and direct build/dev dependencies are pinned exactly, that direct lockfile entries resolve to the expected versions, and that lockfile package URLs resolve from `https://registry.npmjs.org`.
- `.github/workflows/dependency-review.yml` checks whether GitHub Dependency graph is enabled. When it is enabled, `actions/dependency-review-action@v4` runs as a blocking pull request check for moderate or higher vulnerability severity.
- `.github/workflows/dependency-audit.yml` runs `npm audit --omit=dev --audit-level=moderate` weekly and manually.

Secret scanning for public repositories is handled by GitHub, and repository-level push protection should be enabled from GitHub Settings -> Security -> Advanced Security / Secret Protection when available. Push protection is especially useful here because the bot uses Discord tokens, Mongo credentials, metrics tokens, webhook URLs and optional proxy URLs.

Admin-only Discord commands are protected in two layers: slash command metadata sets administrator permissions, and `src/features/command-security/adminCommandRouterGuard.ts` performs a runtime administrator check for `/start`, `/stop` and `/set` before handlers change guild state. This is intentionally kept even if Discord permissions are later changed or overridden.

The Docker runtime image drops to the non-root `node` user after copying the built application and assigning ownership to `/app`. Keep that behavior when changing the Dockerfile, especially for public images published to GHCR.

## Secrets

Never share real `DISCORD_TOKEN`, Mongo credentials, `METRICS_TOKEN`, webhook URLs, proxy URLs or Discord invite links in public issues, pull requests, logs, screenshots or examples.

If a secret is exposed, rotate it immediately before opening a report. Treat the old value as compromised even if the commit was reverted or force-pushed away.

For local examples, use `src/.env.example` placeholders only. Do not copy real `.env` values into README snippets, test fixtures, screenshots or GitHub comments.

## Dependency Review Discipline

Before merging dependency PRs, especially automated Dependabot PRs, check the lockfile diff, the Dependency Review result, the audit result and the package release notes. Treat unexpected registry URLs, new install scripts, ownership changes or sudden large transitive dependency changes as blockers until they are understood.

Build tooling is part of the supply chain too. Keep direct `devDependencies` pinned exactly, review changes to Rust/N-API build tools manually, and do not merge build-tool updates based only on a green install.
