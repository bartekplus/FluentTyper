---
workflow: product-launch-video
flow: automation
storyboard: yes
message: "The product proves itself: every line on screen is text FluentTyper completed or fixed."
destination: youtube
aspect: 1920x1080
language: en
length: 60s
angle: the-text-writes-the-ad
audience: "People who write messages, documents and posts in their browser"
---

## Intent

Version 2 of the FluentTyper promo (2026-10-04). An Apple-like presentation film:
dark, cinematic, calm. Direction "the text writes the ad" (pitch D) with the
editor match cuts of pitch C. There are no feature titles: the on-screen copy is
text that FluentTyper completed, expanded, fixed or rewrote during the recording.
The real UI shows only at the moment it acts. Every feature in 60 seconds or less.

## Assets

- public/icon/icon256.png — the official logo; it lands on moving footage at the close.
- Real extension recordings from the current build (scripts/capture.ts), synthetic text only.
- Local e2e test pages for the editor sequence (Google Docs fixture, Gutenberg fixture).

## Customizations

- Beat plan (about 60 s): cold open "This video was typed with FluentTyper." ·
  completion (popup and inline, Tab) · saved reply · Review (card, Apply, Fix all
  safe, one style hint, Alt+Shift+R) · languages with auto-detect (10 languages) ·
  where you write (match cuts: mail, Google Docs, WordPress, Word if supported) ·
  Local AI rewrite, labelled "Optional · Chrome and Edge" · privacy ("On your
  device. Works offline.") · CTA: logo, "Free · Open source", Chrome · Firefox · Edge.
- Local AI: the user approved a one-time local model download (about 1 GB) so the
  recording shows real model output.
- Camera: slow push-ins and focus on the active control; cuts on the music beat.
- Original score made locally; no voice-over, no captions.

## Notes

- No small print in the frame ("synthetic example", "development build"); claims
  stay in CLAIMS.md.
- Never approximate the product UI: real captures only. Marketing overlays (keys,
  pointer) are labelled annotations in ASSETS.md.
- Version 1 (42 s, light) stays documented in STORYBOARD.md; this is a new section.
