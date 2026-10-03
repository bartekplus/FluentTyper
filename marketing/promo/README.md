# FluentTyper promo — editable HyperFrames project

42 seconds, 1920×1080, 30 fps. Captured from repository HEAD `bda1ebe2ebafd24ff3ff97f9a2fa8145e2ffcbdb` at the user's request. Autocomplete, configured text expansion, Review, Apply and Fix all safe are authentic production-build UI. The final CTA qualifies its development build; source/release/store evidence is kept separately.

## Deliverables

- `renders/fluenttyper-promo-1080p.mp4`: final H.264/AAC MP4 with original instrumental music and action sounds.
- `renders/fluenttyper-promo-poster.png`: clean finished MP4 frame at 21.5s.
- `index.html`, `compositions/frames/*.html`, `compositions/identity.html`: editable HyperFrames assembly and scenes.
- `scripts/compose.ts`: centralized copy, timings, frame placement and visual tokens. Regeneration overwrites manual scene edits; edit this generator or edit scene HTML directly without regenerating.
- `STORYBOARD.md`, `CLAIMS.md`, `ASSETS.md`, `evidence/`: on-screen script, verified claims, provenance and checks.
- `renders/fluenttyper-promo-project.zip`: portable project, pinned lockfile, assets, final MP4/poster and validation evidence. Dependencies, browser profiles and redundant QA captures excluded.

## Reproduce

The PR contains only authoring source and documentation. Generated captures, copied logo/GSAP, synthesized audio, HTML, evidence, MP4, poster and ZIP stay local and are ignored by Git. A fresh checkout must build the extension and capture its native UI before rendering. No model, login or browser-store access is needed. Requires Node 22+, Bun 1.4.2, FFmpeg and Chromium. HyperFrames manages its browser; use its browser/doctor commands if setup is missing.

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
```

`prepare:video` captures real extension interactions, synthesizes the score and generates editable HTML, stable Studio IDs, and local logo/GSAP copies. Capture assertions stop regeneration when product behavior no longer matches the storyboard. The original footage used HEAD `bda1ebe2`; future checkouts capture their own HEAD, recorded in the local interaction evidence. Rendering from the generated files needs no live extension or network requests.

Exact final render command:

```sh
HYPERFRAMES_NO_TELEMETRY=1 node_modules/.bin/hyperframes render \
  --quality delivery --fps 30 --workers 4 \
  --output renders/fluenttyper-promo-1080p.mp4
```

Optional recapture: from the repository root run `bun install --frozen-lockfile` and `bun run build`, then from this project run `bun run capture`. It uses a fresh local profile and synthetic content; current checkout HEAD determines the product. `bun run audio` regenerates the original score; `bun run assemble` regenerates editable scene HTML. Product recapture and the playback diagnostic use the repository’s existing Puppeteer dev dependency; render/check and seek checks work from the portable project. Seek verification deliberately uses the pinned CLI's bundled check helpers; filenames are specific to 0.8.106.

Poster and encoded-file checks:

```sh
ffmpeg -hide_banner -loglevel error -ss 21.5 \
  -i renders/fluenttyper-promo-1080p.mp4 -frames:v 1 -update 1 \
  renders/fluenttyper-promo-poster.png
ffprobe -v error -show_streams -show_format -of json \
  renders/fluenttyper-promo-1080p.mp4
node scripts/verify-playback.mjs # complete normal-speed audio-enabled and muted playback
```

Local Studio uses <http://localhost:3027/#project/promo>. Start/verify it with:

```sh
HYPERFRAMES_NO_TELEMETRY=1 node_modules/.bin/hyperframes preview --background --port 3027
HYPERFRAMES_NO_TELEMETRY=1 node_modules/.bin/hyperframes preview --status
```

All render media is local. Project scripts disable telemetry. Generated renders, snapshots, dependencies and temporary source/profile data are ignored by Git. The source-only PR changes no product code. Rendered deliverables are not published or uploaded. No narration, so no SRT. This export is 16:9; a future vertical version will need deliberate reframing.
