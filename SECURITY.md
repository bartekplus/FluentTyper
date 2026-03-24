# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| Latest release | Yes |
| Previous releases | Best-effort |

FluentTyper is maintained on a best-effort basis, with priority given to the latest released version.

## Privacy Model

FluentTyper is designed with privacy as a core principle:

- All text predictions run locally (Presage WASM engine)
- No typed content is uploaded or transmitted
- Works fully offline
- Minimal browser permissions: `storage` and `activeTab` only
- Host permissions are opt-in per site
- Content Security Policy: `script-src 'self' 'wasm-unsafe-eval'; object-src 'self'`

In development/debug builds, the WebLLM predictor downloads model artifacts only. Typed content never leaves the device.

## Reporting a Vulnerability

**Do not report security vulnerabilities in public GitHub issues.**

Use GitHub private vulnerability reporting:

- [Create a private advisory](https://github.com/bartekplus/FluentTyper/security/advisories/new)

Include in your report:

- A clear description of the issue
- Steps to reproduce
- Potential impact and severity
- Any proof-of-concept details
- Suggested mitigation (if available)

After submission, maintainers will review and coordinate a fix and disclosure timeline.

## Scope

The following areas are in scope for security reports:

- Content script injection or sandbox escapes
- Cross-site data leakage through the extension
- Permission escalation beyond declared manifest permissions
- Bypass of Content Security Policy
- Exposure of user-typed content to external parties
- Vulnerabilities in third-party dependencies (Presage, Tribute)

## Non-Security Issues

- Product bugs: [Bug report form](https://github.com/bartekplus/FluentTyper/issues/new?template=bug_report.yml)
- Feature ideas: [Feature request form](https://github.com/bartekplus/FluentTyper/issues/new?template=feature_request.yml)
