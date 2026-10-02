---
format: 1920x1080
duration: 42s
message: "Write faster. Review with confidence. Keep your words private."
arc: "Immediate payoff → everyday writing → repeat reply → controlled Review → privacy → install"
audience: "People writing messages and replies in their browser"
mode: autonomous
music: original-local-instrumental
captions: skipped (no narration)
---

## Frame 1 — Keep your writing moving

- status: animated
- src: compositions/frames/01-writing.html
- duration: 9s
- transition_in: cut
- scene: Real Presage suggestion accepted with Tab, then the same message continues.
- asset_candidates: assets/ui/01-autocomplete.png, assets/ui/02-autocomplete-accepted.png, assets/ui/typing-00.png through assets/ui/typing-22.png
- motion: discrete states, key press, restrained headline change
- poster: 5s
  0–3: “Less typing. Fewer mistakes.” Native suggestion is visible at the opening; Tab accepts at 1.5s. 3–9: “Keep your writing moving.” Additional text is actually typed on the same surface. Camera stays settled.

## Frame 2 — Repeat replies

- status: animated
- src: compositions/frames/02-expansion.html
- duration: 5s
- transition_in: cut
- scene: The configured callMe shortcut becomes a useful reply through Tab.
- asset_candidates: assets/ui/03-snippet.png, assets/ui/04-snippet-expanded.png
- motion: native screenshot state swap with key callout
- poster: 3s
  “Stop retyping the same replies.” Native shortcut and popup hold for 1.6 seconds, then real accepted result holds. This is a separate synthetic example, labelled Saved reply.

## Frame 3 — Review in control

- status: animated
- src: compositions/frames/03-review.html
- duration: 13s
- transition_in: cut
- scene: Existing draft, native Review launcher, actual category marks, real correction card and Apply.
- asset_candidates: assets/ui/05-review-before.png, assets/ui/06-review-highlights.png, assets/ui/07-review-card.png, assets/ui/08-review-one-fixed.png
- motion: pointer moves from launcher to highlight to Apply; native state changes
- poster: 7s
  “Catch mistakes. Stay in control.” 14–16: existing draft and real entry point. 16–19: native findings. 19–23.5: actual teh→the correction card. Apply at 23.5; remaining findings hold until 27. The top-right corner is clear; development-build qualification appears only on the final CTA.

## Frame 4 — Safe batch payoff

- status: animated
- src: compositions/frames/04-safe.html
- duration: 6s
- transition_in: cut
- scene: Click Fix all safe; actual remaining eligible fixes produce the finished message.
- asset_candidates: assets/ui/08-review-one-fixed.png, assets/ui/09-review-safe-fixed.png, assets/ui/12-clean-final.png
- motion: pointer to actual Fix all safe button; screenshot result swap
- poster: 4s
  “One fix. Or all the safe ones.” Click at 28.6; actual outcome remains visible. No promise that writing is flawless. Actual result: I received the report. We should have reviewed it on Monday.

## Frame 5 — Local words

- status: animated
- src: compositions/frames/05-private.html
- duration: 4s
- transition_in: cut
- scene: Finished message stays; restrained local-processing annotation in the unused right region.
- asset_candidates: assets/ui/12-clean-final.png
- motion: annotation opacity entrance; stable composer
- poster: 2s
  “Your words stay yours.” Supporting line: “FluentTyper doesn’t upload your text.” Local native checks only; the website itself is outside the claim.

## Frame 6 — Get FluentTyper

- status: animated
- src: compositions/frames/06-cta.html
- duration: 5s
- transition_in: cut
- scene: Official logo, large Get FluentTyper action, verified project destination.
- asset_candidates: assets/logo.png
- motion: short staggered entrance; hold all CTA text for final 4 seconds
- poster: 3s
  “Write faster. Review with confidence.” “Get FluentTyper” with “github.com/bartekplus/FluentTyper”. Supporting line: “Chrome · Firefox · Edge” and “Review demo: development build · store versions may vary”. No invented landing domain or store badges.
