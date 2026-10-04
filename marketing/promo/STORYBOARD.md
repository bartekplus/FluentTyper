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

- Google Docs shot: the Docs e2e page is a test fixture. Use it only if it reads as a document editor; else name Docs in the copy only and show WordPress and one other real editor library.
- Not in the film (say so if you want them): per-site settings, preferred terminology, measurement formatting, the stats dashboard.

## Locked

2026-10-04: the user locked the layout of all 17 frames in `storyboard.html` ("Looks perfect! locked!"). The Google Docs shot and the omitted features stay as written in Still open.

## Frame 1 — Caret (0.0–2.0, 2.0 s)

- status: outline
- src: compositions/frames/01-caret.html
- duration: 2s
- transition_in: cut
- scene: A cyan caret blinks alone on the black stage.
- asset_candidates: none (caret is a design element from frame.md)
- poster: 1s

On screen: black stage, one 2 px cyan caret at the optical center, blinking twice. Motion: none for 0.4 s, then two blinks. Seam out: the caret starts typing (hard cut on the same spot). Audio: one soft note at 0.4 s. Constraint: no logo, no title. Why: silence makes the first typed word matter.

## Frame 2 — Typed with Tab (2.0–5.0, 3.0 s)

- status: outline
- src: compositions/frames/02-typed.html
- duration: 3s
- transition_in: cut
- scene: "This message was typed with Tab." types itself; "message" completes from "mes".
- asset_candidates: assets/ui/v2-open-*.png (real popup on "mes")
- poster: 2.5s

On screen: the typed line in `typed` size, centered. At "mes" the real popup capture appears under the caret for 0.4 s; Tab key cap pulses; "message" lands in the gradient. Seam out: the line slides up and dims; the caret drops to a new line. Audio: key ticks, a bright accent on Tab. Constraint: no explanation text. Why: the hook proves the product in the first three seconds.

## Frame 3 — Popup (5.0–8.0, 3.0 s)

- status: outline
- src: compositions/frames/03-popup.html
- duration: 3s
- transition_in: cut
- scene: "Thanks for the rep" → the real popup (report / reported / reports) → Tab → "report".
- asset_candidates: assets/ui/v2-popup-*.png
- poster: 6.5s

On screen: the mail composer capture as product glass at 70 % width; slow push-in toward the caret; the popup lists "report", "reported", "reports". Tab key cap; "report" in the gradient. Seam out: push-in continues into Frame 4 (same window). Constraint: no zoom past the capture's resolution. Why: the core feature, shown large.

## Frame 4 — Inline (8.0–10.5, 2.5 s)

- status: outline
- src: compositions/frames/04-inline.html
- duration: 2.5s
- transition_in: cut
- scene: Inline mode: "I'll review it tod" shows the grey ending "ay"; Tab accepts.
- asset_candidates: assets/ui/v2-inline-*.png
- poster: 9.5s

On screen: same composer, inline mode; the grey suggested ending sits beside the typed letters; Tab; "today" turns ink, then the period. Seam out: the window slides left out of frame; the caret stays. Why: the second typing mode, for people who prefer no popup.

## Frame 5 — Saved reply (10.5–13.5, 3.0 s)

- status: outline
- src: compositions/frames/05-reply.html
- duration: 3s
- transition_in: cut
- scene: The shortcut "callMe" becomes "Call me back once you're free."
- asset_candidates: assets/ui/v2-snippet-*.png
- poster: 12.5s

On screen: large typed "callMe" as a gradient chip; Tab; the chip unfolds into the full sentence in ink. A real popup capture shows the shortcut offer for 0.5 s. Seam out: the sentence fades to grey and drops away. Constraint: no "saved reply" title. Why: reuse in a few letters.

## Frame 6 — Draft with mistakes (13.5–16.0, 2.5 s)

- status: outline
- src: compositions/frames/06-draft.html
- duration: 2.5s
- transition_in: cut
- scene: "i received teh report.We should of reviewed it on monday." gets the real category underlines; Alt+Shift+R key cap.
- asset_candidates: assets/ui/v2-review-highlights.png
- poster: 15.5s

On screen: the draft as product glass; Alt+Shift+R key cap pulses; the real colored underlines appear in sequence (spelling, grammar, punctuation, capitals). Seam out: push-in toward "teh". Why: Review starts with one shortcut and changes nothing yet.

## Frame 7 — Correction card (16.0–19.0, 3.0 s)

- status: outline
- src: compositions/frames/07-card.html
- duration: 3s
- transition_in: cut
- scene: The real card "teh → the"; pointer to Apply; "the" lands in the gradient.
- asset_candidates: assets/ui/v2-review-card.png, assets/ui/v2-review-one-fixed.png
- poster: 18s

On screen: macro on the card (spelling badge, "teh → the", Apply, Ignore once); the pointer clicks Apply; the text changes. Seam out: pull back to the whole draft. Why: the user stays in control, one fix at a time.

## Frame 8 — Fix all safe (19.0–22.0, 3.0 s)

- status: outline
- src: compositions/frames/08-fix-all.html
- duration: 3s
- transition_in: cut
- scene: The real Review panel; Fix all safe; the draft becomes "I received the report. We should have reviewed it on Monday."
- asset_candidates: assets/ui/v2-review-panel.png, assets/ui/v2-review-safe-fixed.png
- poster: 21.5s

On screen: the panel glass slides in from the right; click "Fix all safe (4)"; the remaining fixes flip one after another (accumulation, 120 ms apart). Seam out: the clean sentence holds 0.6 s, then the panel leaves right. Why: the payoff of Review.

## Frame 9 — Style advice (22.0–24.5, 2.5 s)

- status: outline
- src: compositions/frames/09-style.html
- duration: 2.5s
- transition_in: cut
- scene: A real style card on a redundant phrase, for example "ATM machine" → "ATM".
- asset_candidates: assets/ui/v2-style-card.png
- poster: 23.5s

On screen: one sentence with a style underline; the real Style advice card. Constraint: no "AI" wording; this is a native check. Why: advice beyond mistakes, still the user's choice.

## Frame 10 — Every language (24.5–29.5, 5.0 s)

- status: outline
- src: compositions/frames/10-languages.html
- duration: 5s
- transition_in: cut
- scene: One line changes language on each beat (Spanish, German, Polish, Greek, Arabic); the real Review language menu shows "Auto detect: <language>"; "10 languages".
- asset_candidates: assets/ui/v2-lang-es.png, assets/ui/v2-lang-de.png, assets/ui/v2-lang-pl.png, assets/ui/v2-lang-el.png, assets/ui/v2-lang-ar.png
- poster: 28s

On screen: the typed line swaps every 0.8 s on the beat; the Arabic line sets right-to-left; beside it the real language menu capture. Then "10 languages" in `h1`. Seam out: the caret jumps right into the next editor (match cut). Constraint: each line is real text that the build detected and checked. Why: it is not English-only.

## Frame 11 — Everywhere (29.5–35.5, 6.0 s)

- status: outline
- src: compositions/frames/11-everywhere.html
- duration: 6s
- transition_in: cut
- scene: Match cuts on the caret: mail → Google Docs (test page, see Still open) → WordPress (real Gutenberg) → one more rich editor; each shows a real suggestion or Review mark.
- asset_candidates: assets/ui/v2-editor-mail.png, assets/ui/v2-editor-docs.png, assets/ui/v2-editor-gutenberg.png, assets/ui/v2-editor-rich.png
- poster: 33s

On screen: the frame stays still and only the editor inside changes on each cut (1.2–1.5 s each); the caret stays at the same screen position across cuts. Seam out: the last editor dims; the caret stays. Why: it works where people already write.

## Frame 12 — Local AI (35.5–40.5, 5.0 s)

- status: outline
- src: compositions/frames/12-local-ai.html
- duration: 5s
- transition_in: cut
- scene: "can u send me the file asap, thx" → Local AI rewrite (style: Professional) → the real model output; footnote "Optional · Chrome and Edge · runs on your device".
- asset_candidates: assets/ui/v2-ai-before.png, assets/ui/v2-ai-rewrite.png
- poster: 39s

On screen: the real rewrite view as glass; the style chip "Professional"; the output appears (real model text, recorded once); the footnote in `footnote` style. Constraint: no claim beyond "optional, on your device". Why: the optional step up, still private.

## Frame 13 — Your device (40.5–44.0, 3.5 s)

- status: outline
- src: compositions/frames/13-device.html
- duration: 3.5s
- transition_in: cut
- scene: Held frame: "Your words stay on your device."
- asset_candidates: none
- poster: 42s

On screen: black stage, the line in `h1`, nothing moves for 3 s. Audio: the music drops to one sustained chord. Why: the privacy promise, given room.

## Frame 14 — Offline (44.0–47.0, 3.0 s)

- status: outline
- src: compositions/frames/14-offline.html
- duration: 3s
- transition_in: cut
- scene: "Works offline." while a real suggestion appears in a capture recorded with the network off.
- asset_candidates: assets/ui/v2-offline.png
- poster: 46s

On screen: the composer glass, recorded in offline mode, shows a suggestion; the line "Works offline." Why: proof that nothing is sent anywhere.

## Frame 15 — Free (47.0–51.0, 4.0 s)

- status: outline
- src: compositions/frames/15-free.html
- duration: 4s
- transition_in: cut
- scene: "Free. Open source." types in, one word at a time.
- asset_candidates: none
- poster: 50s

On screen: the line in `display` size. Seam out: the words slide up. Why: no price, no lock-in.

## Frame 16 — Browsers (51.0–54.0, 3.0 s)

- status: outline
- src: compositions/frames/16-browsers.html
- duration: 3s
- transition_in: cut
- scene: "Chrome · Firefox · Edge".
- asset_candidates: none
- poster: 53s

On screen: three names in `h2`, appearing on three beats. Constraint: no browser logos or store badges. Why: where to get it.

## Frame 17 — Logo (54.0–60.0, 6.0 s)

- status: outline
- src: compositions/frames/17-logo.html
- duration: 6s
- transition_in: cut
- scene: The caret slides into the logo's F; "FluentTyper"; "Less typing. More you."; "Free for Chrome, Firefox and Edge".
- asset_candidates: assets/logo.png
- poster: 58s

On screen: a slow drift of the typed lines behind (out of focus) keeps the footage moving; the caret moves left and becomes the F; the wordmark and tagline land; the store line in `lead`. Audio: final chord, resolves at 59 s. Why: close on the name and where to get it.
