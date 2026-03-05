# Grammar Extension Competitive Analysis (General Web Mix, March 2026)

## Scope

- Product context: FluentTyper at-cursor replacements and inline suggestions.
- UX goal: maximize writing speed and confidence while minimizing interruptions.
- Constraints: privacy-first, offline-first, no extra permissions.

## Competitor Matrix

| Product          | Trigger model                         | Fast-typing strength                           | Main UX risks                                                                  | Customization quality                                         | FluentTyper takeaway                                                         |
| ---------------- | ------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Grammarly        | Inline + cards + suggestions panel    | Strong breadth of suggestions                  | Can feel intrusive in dense editing; false-positive fatigue for style rewrites | Good global controls, but correction granularity can be broad | Keep suggestion richness optional; default to high-confidence only at cursor |
| LanguageTool     | Inline highlights + popup suggestions | Good lightweight correctness in many languages | Frequent style/grammar flags can interrupt flow in short-form writing          | Strong rule toggles and language controls                     | Match granular rule toggles and explicit rule-level control                  |
| Microsoft Editor | Inline corrections + context menu     | Seamless in Microsoft surfaces                 | In browser contexts, discoverability/consistency can vary                      | Moderate customization                                        | Keep corrections predictable and reversible regardless of site/editor        |
| QuillBot         | Rewrite-focused interaction           | Useful for rephrasing tasks                    | Heavier interaction cost for fast typing; modal workflow                       | Moderate                                                      | Avoid rewrite-first UX for core typing loop                                  |
| ProWritingAid    | Deep analysis panels                  | Strong for long-form review                    | High cognitive load while drafting                                             | High depth but heavy UI                                       | Keep deep analysis out of primary typing path                                |

## Top User Pain Points (Fast Typers)

| #   | Pain point                                         | Severity | Frequency |
| --- | -------------------------------------------------- | -------- | --------- |
| 1   | Incorrect auto-fixes that require manual repair    | High     | High      |
| 2   | UI interruptions (cards/popups) while typing       | High     | High      |
| 3   | Hard-to-predict rule behavior across sites/editors | High     | Medium    |
| 4   | Undo friction after automatic correction           | High     | Medium    |
| 5   | Layout shifts or caret jumps                       | Medium   | Medium    |
| 6   | Overeager style suggestions during drafting        | Medium   | High      |
| 7   | Lack of clear on/off controls per rule             | Medium   | Medium    |
| 8   | Poor handling in code-like or mixed-content fields | Medium   | Medium    |

## What To Copy vs Avoid

| Dimension             | Copy                                                               | Avoid                                               |
| --------------------- | ------------------------------------------------------------------ | --------------------------------------------------- |
| Correction confidence | High-confidence whitelist rules with deterministic behavior        | Ambiguous grammar/style auto-fixes in drafting flow |
| Feedback model        | Subtle inline feedback only when needed                            | Persistent popups/cards competing with text entry   |
| Undo model            | Immediate single-step revert (Backspace + Cmd/Ctrl+Z interception) | Multi-step or opaque undo chains                    |
| Configuration         | Rule-level toggles + safe defaults + advanced off                  | Coarse “all or nothing” control                     |
| Context guards        | Strong skips for code-like/URL/email/composition contexts          | Aggressive replacement in uncertain contexts        |

## Rule Prioritization Framework

Scoring dimensions (0-5):

- User impact
- Precision confidence
- UX risk (inverse score)
- Engineering complexity (inverse score)
- Cross-language safety

Policy:

- `P0 Safe-ON`: high precision, low UX risk, low ambiguity.
- `P1 Advanced-OFF`: useful but style-sensitive or context-sensitive.

## Prioritized Backlog Snapshot

### P0 Safe-ON

- `doubleSpaceToPeriod`
- `englishModalOfCorrection`
- `englishYourWelcomeCorrection`
- `englishTheirThereBeVerb`
- `englishAlotCorrection`
- `englishPronounVerbWhitelistAgreement`

### P1 Advanced-OFF

- `ellipsisShortcut`
- `emdashShortcut`
- `smartQuoteNormalization`
- `duplicatePunctuationCollapse`

## UX Operating Principles for At-Cursor Replacements

1. Atomic and reversible edits

- One auto-fix equals one revertable operation.
- Intercept Cmd/Ctrl+Z for latest auto-fix when snapshot is still valid.

2. Quiet feedback

- No disruptive popup required for auto-fix confirmation.
- Keep visual confirmation subtle and non-layout-shifting.

3. Intent-preserving guardrails

- Skip on delete actions for additive rules.
- Skip likely code-like, URL, email, and uncertain contexts.
- Never force reapply after user explicitly reverts.
