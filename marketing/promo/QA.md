# Final validation

Built with HyperFrames 0.8.106, GSAP 3.14.2, Bun 1.4.2. Product capture source: HEAD `bda1ebe2ebafd24ff3ff97f9a2fa8145e2ffcbdb`, Chrome production build with a fresh profile and synthetic content. Release availability checked independently; the final CTA qualifies its development build.

## Product interactions

`bun run capture` is a runnable assertion-based verification using existing repository E2E helpers. Verified actual prediction list, Tab acceptance, configured snippet expansion, Review opened through its native in-field launcher, categorized findings, selected “teh → the” Apply, remaining Fix all safe and exact final text. Opening Review did not modify the draft. After Apply and Fix all safe, capture waits for both the exact written draft and refreshed native diagnostics; fixed-delay expiry cannot certify a stale plate. Regression coverage rejects old draft text, old findings, pending spelling and busy controls. Final draft: **I received the report. We should have reviewed it on Monday.** All captures and timings are local and frozen before rendering; no model or remote operation is a render dependency. `evidence/interactions.json` stores the capture version read directly from root package metadata, source HEAD, exact states, suggestions, panel text, category marks and button coordinates. The actual capture workflow was also rerun in a temporary checkout fixture with synthetic package version `2099.99.0`; its recorded version matched that fixture, catching the former hardcoded-version defect. This regression reused the current production build and tests metadata binding only. `evidence/future-version-regression.log`.

## HyperFrames checks

- First-pass lint errors were zero. Missing Studio IDs were resolved.
- Updated transition-aware check after removing the corner label passed: **160 layout samples**, zero runtime/layout/motion findings, **23/23 contrast checks** passed. `evidence/check-label.log`.
- **Two reviewed lint warnings remain:** `timeline_track_too_dense` on writing (25 sequential capture states) and Review (4 sequential states). These states describe one continuous authentic UI surface per scene. Splitting each keystroke into a new scene would add structure without changing output. Every clip has a stable editable ID. No missing assets, remote fonts, clipped CTA or overlap findings remain.
- **29 direct forward/backward seeks:** exact visible text, image sources, opacity, transforms and geometry match at all action boundaries and scene transitions. `evidence/seeks.json`.
- Same 29 screenshot pairs pass bounded pixel equivalence. Maximum RMS channel difference **0.0071/255**, maximum channel difference **2/255**, changed pixel fraction **0.0063%**. Small raster-edge differences are confined to static image pixels; byte-identical PNGs are not claimed. `evidence/seek-pixels.json`.
- Representative frames and both sides of every major transition were visually inspected via HyperFrames snapshots. Opening contains the real suggestion, individual and batch actions have clear input/result states, and the final CTA is fully readable for over four seconds. Check/snapshot contrast cannot audit text baked into screenshots; native screenshot text and controls were inspected separately at full and half-size playback.

## Finished MP4

`evidence/ffprobe.json` confirms **42.000000 seconds**, **1920×1080**, **30/1 fps**, **1260 frames**, **H.264**, **yuv420p**, and **AAC stereo 48 kHz audio**. The `moov` box precedes `mdat`, suitable for progressive web playback. Final local HyperFrames render completed in 28.9 seconds using screenshot capture and hardware GPU. All 1260 encoded frames are present. `evidence/render-label.log`.

Final original audio: mean **−22.1 dBFS**, peak **−8.2 dBFS**, no sample/encoded clipping. Gentle attack and final 2.3-second resolution fade. No narration, no caption/SRT dependency. `evidence/audio-analysis.log`; original synthesis source and provenance in `ASSETS.md`.

The final encoded file is played end-to-end at normal speed in a clean browser twice: audio enabled and muted, at a **960×540 half-size viewport**. `evidence/playback.json` records duration, current time, decode counts, errors and diagnostic dropped frames; screenshots under ignored `renders/qa/` support visual review. Each mode loads a fresh video element so its frame counters start independently. The verifier fails unless each run reports zero decode errors, zero dropped frames, exactly 1260 decoded/total video frames and the complete 42-second duration. Regression tests reject degraded, missing and cumulative counters even when playback reaches the end. Both final runs completed with zero decoding errors and zero dropped frames; all 1260 frames played in each mode. Audio playback/decode, levels and fade were checked programmatically; a human listening evaluation is not claimed.

Poster is extracted from the actual finished MP4 at 21.5 seconds. Black-frame detection found no black intervals, and no unintended silence was detected. Results are stored in `evidence/black-detect.log` and `silence-detect.log`. Media hashes and file metadata in `evidence/output-properties.json`.

## Source-only PR reproduction

A temporary project containing only the staged authoring source started with no captures, audio, HTML or interaction evidence. `bun run prepare:video` recreated all required render inputs and passed native interaction assertions. Existing pinned dependency installations, the HEAD production build, E2E helpers and official repository logo were reused locally; this was not a fresh dependency download or an extension rebuild. `evidence/source-reproduction.json`.

## Delivery scope

Working project and local Studio preview, final MP4, poster, portable ZIP, storyboard, claims, licenses/provenance and reproducible commands are included. Generated output/dependencies/profile data are ignored by Git. No extension source, prediction engine, AI behavior or permissions were changed. The source-only PR excludes generated media, HTML, captured evidence and copied dependencies. No paid service, model download, media upload, telemetry or video publishing operation was performed.

Remaining limits: footage demonstrates the requested HEAD, rather than asserting store-identical UI; future vertical output needs reframing; two timeline-density notices are intentional. Browser-store versions and future source behavior can change. No claim of universally error-free writing or universal site compatibility is made.
