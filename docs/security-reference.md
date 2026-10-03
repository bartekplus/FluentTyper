# Security and privacy reference

[FluentTyper](../README.md) / [Security](../SECURITY.md) / Engineering reference

This reference describes implementation safeguards. For private reporting, use the [security policy](../SECURITY.md#report-a-security-issue).

FluentTyper is designed with privacy as a core principle:

- All text predictions run locally (Presage WASM engine)
- No typed content is uploaded or transmitted
- Works fully offline
- Minimal browser permissions: `storage` and `activeTab`
- Host permissions are opt-in per site
- Content Security Policy: `script-src 'self' 'wasm-unsafe-eval'; object-src 'self'`; on
  Chrome and Edge, `connect-src` is limited to the extension itself and the Hugging Face
  origins that serve the optional model's data files

**Optional Local AI in Review (Chrome, Edge).** Inference runs on the device (WebGPU) in the
extension's background service worker. The inference runtime (Transformers.js and ONNX Runtime Web, Apache-2.0/MIT)
ships inside the extension and is checked by hash at build time; nothing executable is
downloaded. Only the model's files (weights, tokenizer, configuration) are downloaded, from a
pinned revision, after the user's explicit setup action; the engine fetches only the files
listed for that revision and verifies each one's SHA-256 before the model counts as installed.
Reviewed text, prompts and model output are never uploaded, logged or persisted; they live
in memory for the open review, and the model is unloaded when the last Review closes (GPU
and operating system memory are not cryptographically erased). Model output is treated as
untrusted data: it is parsed strictly, validated against the original text, rendered as
text, and applied only through the user's explicit action and the existing verified editor
write. Autocomplete never uses the model. See [availability](local-ai-review.md) and the
[implementation reference](local-ai-reference.md).
