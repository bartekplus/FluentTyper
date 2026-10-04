# Security and privacy reference

[FluentTyper](../README.md) / [Security](../SECURITY.md) / Engineering reference

This reference describes implementation safeguards. For private reporting, use the [security policy](../SECURITY.md#report-a-security-issue).

Safeguards:

- Minimal browser permissions: `storage` and `activeTab`
- Host permissions are opt-in per site
- Content Security Policy: `script-src 'self' 'wasm-unsafe-eval'; object-src 'self'`; on
  Chrome and Edge, `connect-src` is limited to the extension itself and the Hugging Face
  origins that serve the optional model's data files

For local processing and offline use, see [Your text and privacy](../SECURITY.md#your-text-and-privacy).

**Optional Local AI in Review (Chrome, Edge).** Model output is untrusted data: it is
parsed strictly, validated against the original text, rendered as text, and applied only
through the user's explicit action and the verified editor write. See
[privacy](local-ai-review.md#your-text-stays-on-your-device) and
[packaging](local-ai-reference.md#packaging-release-gate).
