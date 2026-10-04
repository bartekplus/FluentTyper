# Assets

- **Product UI:** recorded by `scripts/capture.ts`, `capture-ai.ts` and `capture-wordpress.ts` in Puppeteer Chrome, 1200×640 at DPR 2, dark theme (`prefers-color-scheme: dark`), synthetic text only.
- **Third-party context:** a real local WordPress 7.1.2 (Playground, its default local admin account) and the real Slate editor library inside a synthetic Notes page. The mail window is synthetic.
- **Logo:** `public/icon/icon256.png`, copied to `assets/logo.png`. The accent gradient (#1BD9FD to #1FA7F3) is sampled from it.
- **Music:** `scripts/audio.py`, an original 60 s score synthesized from sine tones. No samples, no third-party music, no voice.
- **Marketing annotations:** captions with key chips (Tab, Alt + Shift + R), the pointer, the cyan caret and the typed opening line. The opening line repeats text that the product typed in the capture.
- **Fonts and libraries:** system-ui only, no remote fonts. GSAP 3.14.2 is copied locally from the pinned dependency; HyperFrames 0.8.106 renders locally.
