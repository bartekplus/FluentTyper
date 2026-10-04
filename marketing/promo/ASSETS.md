# Assets and production notes

- Logo: exact repository `public/icon/icon256.png`, copied to `assets/logo.png`. Product trademark remains its owner's; used only in the requested FluentTyper promotion. Repository code is MIT.
- Native UI: captured by `scripts/capture.ts` from the production build of HEAD `bda1ebe2`, in a fresh Puppeteer Chrome profile. All text and recipients are synthetic. Captured plates use a 1000×480 viewport at DPR 2 and are displayed at 1728×829.44; no screenshot upscaling beyond captured resolution.
- Fonts: `system-ui`, matching the extension's native style. No remote fonts; UI typography is baked into the captures. Editorial headings use the local OS system font.
- Original music and action sounds: entirely synthesized locally by `scripts/audio.py`, 100 BPM, 42s stereo 48 kHz PCM. Original Dmaj7/Bm7/Gmaj7/Aadd9 instrumental arrangement with sparse plucks, gentle chord tones, acceptance/correction accents and quiet typing accents. No samples, purchased assets, third-party music or voice. Generated for this project; reusable with the deliverable.
- GSAP 3.14.2: local vendored distribution from the pinned dependency. Preserve its embedded copyright/license notice. HyperFrames 0.8.106: Apache-2.0 CLI dependency, local rendering only. Dependency license files remain in the installed packages; `bun.lock` preserves resolution.
- Editorial overlays: the Tab callout, pointer, brief click pulses, progress rule and device outline are marketing annotations. They are not extension controls or invented product states. Native pointer targets derive from recorded launcher, highlight, Apply and batch button geometry. The only UI surface outside the product is the neutral synthetic message composer.
- Editing: screenshot changes reproduce observed input/action/result states; per-character continuation plates are actual typing captures. No inference, timer or live input runs in the video. Hard cuts and registered paused GSAP timelines make scenes seekable. All media playback belongs to HyperFrames.
- Local-only: no HeyGen login, paid services, uploads, publishing, telemetry, remote render fonts or network inference. `HYPERFRAMES_NO_TELEMETRY=1` is set on every HyperFrames script. Snapshot optional remote descriptions are disabled with `--describe false`.
- Profile: synthetic settings enable Tab, English, one snippet, the light OS theme and native Review; Local AI is off and its setup offer dismissed.

No narration, so no captions/SRT are generated. Photo grading is inapplicable: this film carries authentic UI, whose colors are preserved.
