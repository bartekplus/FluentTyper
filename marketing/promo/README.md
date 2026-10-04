# FluentTyper promo — editable HyperFrames project

42 seconds, 1920×1080, 30 fps. Captured from repository HEAD `bda1ebe2ebafd24ff3ff97f9a2fa8145e2ffcbdb`. Autocomplete, configured text expansion, Review, Apply and Fix all safe are authentic production-build UI. The final CTA qualifies its development build; source/release/store evidence is kept separately.

## Deliverables

- `renders/fluenttyper-promo-1080p.mp4`: final H.264/AAC MP4 with original instrumental music and action sounds.
- `renders/fluenttyper-promo-poster.png`: clean finished MP4 frame at 21.5s.
- `index.html`, `compositions/frames/*.html`, `compositions/identity.html`: editable HyperFrames assembly and scenes.
- `scripts/compose.ts`: centralized copy, timings, frame placement and visual tokens. Regeneration overwrites manual scene edits; edit this generator or edit scene HTML directly without regenerating.
- `STORYBOARD.md`, `CLAIMS.md`, `ASSETS.md`, `evidence/`: on-screen script, verified claims, provenance and checks.
- `renders/fluenttyper-promo-project.zip`: portable project, pinned lockfile, assets, final MP4/poster and validation evidence. Dependencies, browser profiles and redundant QA captures excluded.

## Reproduce

Generated captures, copied logo/GSAP, synthesized audio, HTML, evidence, MP4, poster and ZIP stay local and are ignored by Git. A fresh checkout must build the extension and capture its native UI before rendering. No model, login or browser-store access is needed. Requires Node 22+, Bun 1.4.2, FFmpeg and Chromium. HyperFrames manages its browser; use its browser/doctor commands if setup is missing.

From the repository root:

```sh
bun install --frozen-lockfile
bun run build
cd marketing/promo
bun install --frozen-lockfile
bun run prepare:video
bun run check
bun run verify:seeks
python3 scripts/verify-pixels.py # Pillow required for this optional pixel check
bun run dev
bun run render
bun run verify:playback
bun run store-images # Chrome Web Store images in renders/store/
```

`prepare:video` captures real extension interactions, synthesizes the score and generates editable HTML, stable Studio IDs, and local logo/GSAP copies. Capture assertions stop regeneration when product behavior no longer matches the storyboard. The original footage used HEAD `bda1ebe2`; future checkouts capture their own HEAD, recorded in the local interaction evidence. Rendering from the generated files needs no live extension or network requests. Capture uses a fresh local profile and synthetic content. Product recapture and the playback diagnostic use the repository’s existing Puppeteer dev dependency; render/check and seek checks work from the portable project. Seek verification deliberately uses the pinned CLI's bundled check helpers; filenames are specific to 0.8.106.

Poster and encoded-file checks:

```sh
ffmpeg -hide_banner -loglevel error -ss 21.5 \
  -i renders/fluenttyper-promo-1080p.mp4 -frames:v 1 -update 1 \
  renders/fluenttyper-promo-poster.png
ffprobe -v error -show_streams -show_format -of json \
  renders/fluenttyper-promo-1080p.mp4
```

Local Studio uses <http://localhost:3027/#project/promo>. `bun run dev` starts it.

All render media is local. Project scripts disable telemetry. Generated renders, snapshots, dependencies and temporary source/profile data are ignored by Git. Rendered deliverables are not published or uploaded. No narration, so no SRT. This export is 16:9; a future vertical version will need deliberate reframing.
