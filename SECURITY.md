# Privacy and security

[FluentTyper](README.md) / Privacy and security

Your typed content stays on your device. If you find a security issue, report it privately so maintainers can investigate.

## Report a security issue

**Do not include a security vulnerability in a public GitHub issue.**

[Create a private security advisory](https://github.com/bartekplus/FluentTyper/security/advisories/new).

Include:

- What can go wrong and who it affects.
- The steps needed to reproduce the issue.
- Your browser and FluentTyper version.
- A minimal example or proof of concept, if available.
- A possible fix, if you know one.

Use synthetic text when possible. Do not include passwords or private drafts.
Maintainers will review the report and coordinate a fix and disclosure timeline.

## Your text and privacy

Word suggestions and standard Review run locally and work offline. FluentTyper does not upload your typed content.
It does not log or save reviewed text. User settings, saved shortcuts, and words you add to the dictionary are separate local data.

You control which sites FluentTyper can access. See [site settings](docs/site-settings.md).

Optional Local AI remains a development feature. Its setup downloads model files only after your consent.
The download provider receives connection information, such as your IP address, but never your reviewed text.
After installation, inference runs on your device. See [Local AI privacy and removal](docs/local-ai-review.md).

## Supported versions

| Version           | Maintenance                           |
| ----------------- | ------------------------------------- |
| Latest release    | Priority for investigation and fixes. |
| Previous releases | Best effort.                          |

Maintenance is on a best-effort basis. This policy does not promise a response or fix within a fixed time.

## What belongs in a private report

Examples include exposure of typed content, cross-site data leakage, permission escalation, sandbox escapes, or a Content Security Policy bypass.
Dependency vulnerabilities also belong here, including those in Presage and Tribute.

For ordinary product problems, use the [bug report form](https://github.com/bartekplus/FluentTyper/issues/new?template=bug_report.yml).
For new ideas, use the [feature request form](https://github.com/bartekplus/FluentTyper/issues/new?template=feature_request.yml).

---

[Implementation safeguards](docs/security-reference.md) · [Contribute](CONTRIBUTING.md) · [Return to FluentTyper](README.md)
