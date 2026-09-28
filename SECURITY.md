# Security Policy

## Supported Versions

| Version           | Supported   |
| ----------------- | ----------- |
| Latest release    | Yes         |
| Previous releases | Best-effort |

FluentTyper is maintained on a best-effort basis, with priority given to the latest released version.

## Privacy Model

FluentTyper is designed with privacy as a core principle:

- All text predictions run locally (Presage WASM engine)
- No typed content is uploaded or transmitted
- Works fully offline
- Minimal browser permissions: `storage` and `activeTab`, plus `offscreen` on Chrome and
  Edge (it hosts the optional Local AI model's worker; no install warning, no page access)
- Host permissions are opt-in per site
- Content Security Policy: `script-src 'self' 'wasm-unsafe-eval'; object-src 'self'`; on
  Chrome and Edge, `connect-src` is limited to the extension itself and the Hugging Face
  origins that serve the optional model's data files

**Optional Local AI in Review (Chrome, Edge).** Inference runs on the device (WebGPU) in an
extension worker. The inference runtime (Transformers.js and ONNX Runtime Web, Apache-2.0/MIT)
ships inside the extension and is checked by hash at build time; nothing executable is
downloaded. Only the model's files (weights, tokenizer, configuration) are downloaded, from a
pinned revision, after the user's explicit setup action; the worker fetches only the files
listed for that revision and verifies each one's SHA-256 before the model counts as installed.
The model uses GPU memory only while a Review with Local AI is open. Reviewed text, prompts and model
output are never uploaded, logged or persisted; they live in memory for the open review.
Model output is treated as untrusted data: it is parsed strictly, validated against the
original text, rendered as text, and applied only through the user's explicit action and
the existing verified editor write. Autocomplete never uses the model. GPU and operating
system memory are not cryptographically erased; the engine is unloaded after an idle
interval and conversation state is reset between jobs.

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
