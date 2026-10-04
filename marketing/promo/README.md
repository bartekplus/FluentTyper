# FluentTyper promo

A 60 s, 1920×1080, 30 fps product film built with HyperFrames. One dark window holds the product; its states cross-fade in place, close-ups are camera zooms, and one caption says what happens. Every product shot is a recording of the real extension with synthetic text.

## Files

- `scripts/capture.ts`, `capture-ai.ts`, `capture-wordpress.ts`: record the product shots. Each shot asserts the real product state first, so a changed behavior stops the run.
- `scripts/compose.ts`: builds `index.html` and `compositions/frames/*.html` from the shots (copy, timing and camera moves live here). Regeneration overwrites the HTML: edit this script.
- `scripts/audio.py`: the original score, synthesized locally.
- `scripts/store-images.ts`: Chrome Web Store images.
- `CLAIMS.md`, `ASSETS.md`: the proof for each on-screen claim, and where each asset comes from.

Captures, HTML, audio, evidence and renders stay local and are ignored by Git.

## Make the film

Needs Node 22+, Bun 1.4.2, FFmpeg and Chromium. From the repository root:

```sh
bun install --frozen-lockfile
bun run build
cd marketing/promo
bun install --frozen-lockfile
bun run prepare:video   # capture, Local AI, WordPress, audio, assemble
bun run check
bun run dev             # Studio: http://localhost:3027/#project/promo
bun run render          # renders/fluenttyper-promo-1080p.mp4
bun run store-images    # renders/store/
```

- `capture:ai` installs the Recommended Local AI model (about 4.9 GB, pinned Hugging Face revision) into `.cache/promo-local-ai/` on its first run and needs a visible Chrome window (WebGPU with shader-f16).
- `capture:wordpress` starts a local WordPress Playground site. Playground needs Node 22 or 24: set `WORDPRESS_NODE_BIN`. Set `PROMO_WP_ZIP` to a local copy of the core zip when wordpress.org is not reachable.

All project scripts disable HyperFrames telemetry. Nothing is uploaded or published.
