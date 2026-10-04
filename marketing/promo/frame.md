---
version: alpha
name: FluentTyper Keynote — Frame (video / frame layer)
description: >
  Bespoke dark, cinematic frame system for the FluentTyper v2 promo. The unit is the
  frame (1920×1080). A near-black stage, one idea per frame, very large system type in
  white with an Apple-style grey ladder, and the real product UI lit like glass on the
  stage. The FluentTyper cyan→blue gradient (from the logo) is the only color and appears
  at most once per frame, on the word or control that acts. Motion is out of scope here.
unit: the frame — 1920×1080 only (16:9 destination)
principle: the product proves itself · one idea per frame · color only where FluentTyper acts

colors:
  stage: "#000000"
  stage-lift: "#0B0B0D"
  surface: "#16161A"
  hairline: "#2A2A30"
  ink: "#F5F5F7"
  ink-2: "#A1A1A6"
  ink-3: "#6E6E73"
  accent-cyan: "#1BD9FD"
  accent-blue: "#1FA7F3"
  accent-gradient: "linear-gradient(90deg, #1BD9FD 0%, #1FA7F3 100%)"
  glow: "rgba(31,167,243,0.28)"

typography:
  caption: { fontFamily: "system-ui", cqw: 0.95, weight: 500, lineHeight: 1.4, tracking: "0.01em" }
  label:   { fontFamily: "system-ui", cqw: 1.05, weight: 600, lineHeight: 1.3, tracking: "0.04em", upper: true }
  lead:    { fontFamily: "system-ui", cqw: 1.9, weight: 500, lineHeight: 1.35, tracking: "-0.01em" }
  typed:   { fontFamily: "system-ui", cqw: 3.6, weight: 600, lineHeight: 1.15, tracking: "-0.02em" }
  h2:      { fontFamily: "system-ui", cqw: 4.6, weight: 700, lineHeight: 1.05, tracking: "-0.03em" }
  h1:      { fontFamily: "system-ui", cqw: 6.8, weight: 700, lineHeight: 1.0, tracking: "-0.035em" }
  display: { fontFamily: "system-ui", cqw: 9.5, weight: 800, lineHeight: 0.95, tracking: "-0.045em" }

spacing:
  pad-x: "8cqw"
  pad-y: "7cqw"
  gap-lg: "4cqw"
  gap-md: "2cqw"
  gap-sm: "0.8cqw"

components:
  stage:
    backgroundColor: "{colors.stage}"
    vignette: "radial-gradient(ellipse at 50% 45%, {colors.stage-lift} 0%, {colors.stage} 70%)"
    description: "Every frame stands on the black stage; the vignette is the only ground texture."
  typed-line:
    typography: "{typography.typed}"
    color: "{colors.ink}"
    caret: "2px {colors.accent-cyan}, blinking 1.06 s, visible only while typing"
    description: "The ad copy, as FluentTyper types it. Centered, one line, never more than two."
  acted-word:
    color: "{colors.accent-gradient} as background-clip text"
    description: "The word FluentTyper completed, expanded, fixed or rewrote. At most one per frame."
  product-glass:
    border: "1px solid {colors.hairline}"
    radius: "18px"
    shadow: "0 40px 120px rgba(0,0,0,0.6), 0 0 80px {colors.glow}"
    description: "A real UI capture, lit on the stage. Never redrawn; scale only, never stretched."
  key-cap:
    backgroundColor: "{colors.surface}"
    border: "1px solid {colors.hairline}"
    radius: "12px"
    typography: "{typography.label}"
    description: "Marketing annotation for a key press (Tab, Alt+Shift+R). Labelled in ASSETS.md."
  footnote:
    typography: "{typography.caption}"
    color: "{colors.ink-3}"
    description: "One short qualifier only where a claim needs it (Optional · Chrome and Edge)."
---

## Overview

A keynote-style product film on a black stage. The typed copy is the voice of the film:
the viewer reads the words FluentTyper completes and fixes. The real UI appears only at the
moment it acts, large and lit, then gives the stage back to the words.

## The Frame

- One idea per frame. Center the typed line on the optical center (about 46 % from the top).
- Product captures take 55–80 % of the frame width when they are the subject.
- Keep all content inside the title-safe box (80 %).

## Colors

Black stage, white ink, grey ladder for secondary text. The cyan→blue gradient marks only
what FluentTyper does: the completed word, the fixed word, the accepted control. Never use it
as a background fill.

## Typography

system-ui only (SF Pro on the render machine). Large sizes with tight negative tracking for
display; weights 600–800. No serif, no mono, no all-caps except `label`.

## Depth & Surface

Depth comes from light, not borders: a soft vignette on the stage and a cyan glow behind the
product glass. No hard drop shadows, no outlines except the glass hairline.

## Composition Rules

- No small print in the frame; claims live in CLAIMS.md.
- No feature titles. The typed line or the UI state says what the feature does.
- One acted word per frame.

## Numerals & Claims (hard rule)

Only claims verified in CLAIMS.md: "10 languages" (README list), "Works offline", "Free",
"Open source", "Chrome · Firefox · Edge". No user counts, ratings, speed multipliers or badges.

## Pre-Render Self-Audit

- Every acted word is real captured output.
- No frame shows more than one gradient element.
- Text contrast passes WCAG AA on the stage.
