---
format: 1920x1080
duration: 60s
version: v2
message: "The product proves itself: every line on screen is text FluentTyper completed or fixed."
arc: "Caret → write → reuse → review → every language → everywhere → Local AI → private → free → logo"
audience: "People who write messages, documents and posts in their browser"
mode: collaborative
music: original-local-instrumental
captions: skipped (no narration)
---

Version 2, 2026-10-04. Version 1 (42 s, light) is kept word for word in `STORYBOARD.v1.md`.

## Decisions

- **Message:** the product proves itself. Every line of on-screen copy is text that FluentTyper completed, expanded, fixed or rewrote during the recording.
- **Audience and arc:** people who write in the browser. Caret → write → reuse → review → every language → everywhere → Local AI → private → free → logo.
- **Format:** 16:9, 1920×1080, 60 s, no voice-over, original local music, no captions.
- **Spine:** the cyan caret. It blinks alone at the start, types every line, jumps between editors on match cuts, and at the end slides into the logo's F.
- **Brand:** `frame.md` (bespoke "FluentTyper Keynote"): black stage, ink #F5F5F7, grey ladder #A1A1A6 / #6E6E73, logo gradient #1BD9FD → #1FA7F3 (sampled from `public/icon/icon256.png`), system-ui type.
- **Bans:** no feature titles; no small print; no fake product UI; no static end card; no side-by-side explainer layouts; no more than one gradient element per frame. Motion failures to avoid: the slideshow (a new card for every beat) and the screensaver (motion that says nothing).
- **Held frame:** Frame 13. Nothing moves; the privacy line lands.
- **Truthfulness:** the large typed line repeats, letter for letter, the text of the recorded field at that moment. Every UI panel is a real capture of the current build with synthetic text. Key caps and the pointer are labelled marketing annotations (ASSETS.md).

## Still open

- Google Docs shot: resolved. The Docs e2e page says "NOT Google Docs" on screen, so Docs is named in the copy only. Frame 11 shows the mail window, a real WordPress 7.1.2 editor (local Playground) and a synthetic Notes app on the real Slate editor.
- Not in the film (say so if you want them): per-site settings, preferred terminology, measurement formatting, the stats dashboard.

## Changes after review (2026-10-04, v2.1)

User note, verbatim: "What im not sure, it's black, then the white editors popup, it jumps from thing to things, I know the product, and Im sometimes lost what happend! Improve it!"

What the note meant and what moved:

- Theme flip: the product is now recorded in dark mode (window, popup, Review, Notes). Only WordPress stays light, shown small in a row.
- Jumps: one persistent window stays at the same place from 4.5 s to 40.5 s. States cross-fade in place; each scene starts on the previous scene's last state; close-ups are camera zooms into the window.
- Lost: one plain caption under the window says what happened at every beat, with key chips inside the sentence.
- Taste review (design-taste-frontend): no cyan glow, near-black stage (#0a0a0c), the accent only on the caret and the opening word, no middle-dot lists.
- 17 frames became 13: the separate typed lines, crops and big-type feature frames were folded into the window.

## Locked

2026-10-04: the user locked the layout of all 17 frames in `storyboard.html` ("Looks perfect! locked!"). The Google Docs shot and the omitted features stay as written in Still open.

## Frame 1 — Caret (0–2, 2 s)

- status: animated
- src: compositions/frames/01-caret.html
- duration: 2s
- transition_in: cut
- scene: A cyan caret blinks alone on the near-black stage.
- asset_candidates: none (design element)

## Frame 2 — Typed with Tab (2–4.5, 2.5 s)

- status: animated
- src: compositions/frames/02-typed.html
- duration: 2.5s
- transition_in: cut
- scene: "This message was typed with Tab." types itself; the real popup offers "message"; Tab.
- asset_candidates: assets/ui/v2-open-popup.png

## Frame 3 — Completion (4.5–10.5, 6 s)

- status: animated
- src: compositions/frames/03-completion.html
- duration: 6s
- transition_in: cut
- scene: The persistent dark window rises. Push-in to the real popup, Tab, then a pan to the inline ending, Tab.
- asset_candidates: assets/ui/v2-popup.png, v2-popup-accepted.png, v2-inline.png, v2-inline-accepted.png

Caption: "Press Tab to finish the word." / "Or accept the ending right in the line Tab"

## Frame 4 — Saved reply (10.5–14, 3.5 s)

- status: animated
- src: compositions/frames/04-reply.html
- duration: 3.5s
- transition_in: cut
- scene: Same window: "callMe" offers the saved reply; Tab expands it.
- asset_candidates: assets/ui/v2-snippet.png, v2-snippet-expanded.png

Caption: "Type a shortcut. Tab Get the whole reply."

## Frame 5 — Review (14–25, 11 s)

- status: animated
- src: compositions/frames/05-review.html
- duration: 11s
- transition_in: cut
- scene: Same window: Review opens with its underlines; zoom into the correction card, the pointer applies it; zoom out, Fix all safe; zoom into the style card.
- asset_candidates: assets/ui/v2-review-highlights.png, v2-review-card.png, v2-review-one-fixed.png, v2-review-safe-fixed.png, v2-style-card.png

Caption: "Press Alt + Shift + R Review finds what you missed." / "Check each fix before you apply it." / "Or apply every safe fix at once." / "Style advice, when you want it."

## Frame 6 — Languages (25–30, 5 s)

- status: animated
- src: compositions/frames/06-languages.html
- duration: 5s
- transition_in: cut
- scene: Same window: the text changes language on each beat; the Review menu shows the detected language.
- asset_candidates: assets/ui/v2-lang-es.png, v2-lang-de.png, v2-lang-pl.png, v2-lang-el.png, v2-lang-ar.png

Caption: "Works in 10 languages."

## Frame 7 — Everywhere (30–35.5, 5.5 s)

- status: animated
- src: compositions/frames/07-everywhere.html
- duration: 5.5s
- transition_in: cut
- scene: The window shrinks into a row with real WordPress and the Notes app, then grows back.
- asset_candidates: assets/ui/v2-popup.png, v2-editor-wordpress.png, v2-editor-notes.png

Caption: "Works where you write." / "Mail, WordPress, Google Docs and more."

## Frame 8 — Local AI (35.5–40.5, 5 s)

- status: animated
- src: compositions/frames/08-localai.html
- duration: 5s
- transition_in: cut
- scene: Same window: the real rewrite; zoom into the diff; the window fades out.
- asset_candidates: assets/ui/v2-ai-before.png, v2-ai-rewrite.png

Caption: "Rewrite a draft with optional Local AI." / "Chrome and Edge. Runs on your device."

## Frame 9 — Your device (40.5–44, 3.5 s)

- status: animated
- src: compositions/frames/09-device.html
- duration: 3.5s
- transition_in: cut
- scene: Held frame: "Your words stay on your device."
- asset_candidates: none

## Frame 10 — Offline (44–47, 3 s)

- status: animated
- src: compositions/frames/10-offline.html
- duration: 3s
- transition_in: cut
- scene: The window returns with a suggestion recorded offline.
- asset_candidates: assets/ui/v2-offline.png

Caption: "Works offline, too."

## Frame 11 — Free (47–51, 4 s)

- status: animated
- src: compositions/frames/11-free.html
- duration: 4s
- transition_in: cut
- scene: "Free. Open source." one line at a time.
- asset_candidates: none

## Frame 12 — Browsers (51–54, 3 s)

- status: animated
- src: compositions/frames/12-browsers.html
- duration: 3s
- transition_in: cut
- scene: "Chrome. Firefox. Edge." on three beats.
- asset_candidates: none

## Frame 13 — Logo (54–60, 6 s)

- status: animated
- src: compositions/frames/13-logo.html
- duration: 6s
- transition_in: cut
- scene: The caret slides into the logo; "FluentTyper", "Less typing. More you.", "Free for Chrome, Firefox and Edge".
- asset_candidates: assets/logo.png
