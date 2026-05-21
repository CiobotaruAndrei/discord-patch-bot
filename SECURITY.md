# Security Policy

## Supported Versions

Security fixes target the latest `main` branch and the latest published GitHub Release.

## Reporting a Vulnerability

Please do not open public issues for vulnerabilities or secret leaks. This includes Discord token exposure, MongoDB credential exposure, SSRF or unsafe external URL handling, Discord permission bypasses, webhook leaks, proxy URL leaks, and metrics endpoint exposure.

Report vulnerabilities privately through GitHub Security Advisories:

https://github.com/CiobotaruAndrei/discord-patch-bot/security/advisories/new

Please include:

- affected feature and expected impact;
- steps to reproduce;
- relevant configuration with real secrets removed;
- logs or screenshots with tokens, URLs and credentials redacted;
- whether the issue affects local Docker, production deployment, or both.

I will try to acknowledge valid reports within 72 hours. Confirmed issues should be fixed on a private branch or security advisory first, then released with a changelog note.

## Secrets

Never share real `DISCORD_TOKEN`, Mongo credentials, `METRICS_TOKEN`, webhook URLs, proxy URLs or Discord invite links in public issues, pull requests, logs, screenshots or examples.

If a secret is exposed, rotate it immediately before opening a report.
