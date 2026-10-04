# Claims and proof

Every product shot is recorded from a production build of this repository with synthetic text. Evidence: `evidence/interactions.json`, `evidence/local-ai.json` (local, ignored by Git).

| On-screen claim or action                                                   | Proof                                                                                                                                                                                        |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Popup and inline completion, Tab                                            | `capture.ts` asserts the real suggestion list ("report") and the inline ending ("ay") before each shot.                                                                                      |
| Saved reply                                                                 | A configured `callMe` shortcut; the expanded text is asserted.                                                                                                                               |
| Review: Alt + Shift + R, the card, Apply, Fix all safe                      | Opened by the keyboard command's own path (`triggerReview`); every written result is asserted.                                                                                               |
| Style advice                                                                | The opt-in `styleRedundancy` check; the real card is recorded.                                                                                                                               |
| Works in 10 languages                                                       | README language list. The film shows 5 lines; each one was detected by auto-detect, and the menu shows the detected language.                                                                |
| Works where you write: mail, WordPress, Google Docs and more                | Mail: a synthetic window. WordPress: real WordPress 7.1.2 in a local Playground. Notes: a synthetic app on the real Slate editor. Google Docs is named only (README "Write in Google Docs"). |
| Optional Local AI rewrite, Chrome and Edge, runs on your device             | The Recommended model is installed from the options page; the real model output is recorded. README: Local AI is optional and not in Firefox builds.                                         |
| Your words stay on your device. Nothing is uploaded. It works offline, too. | README "Your words stay yours": FluentTyper "does not upload your typed content"; suggestions and standard Review work "including offline".                                                  |
| Free. Open source. Chrome. Firefox. Edge.                                   | README: "Free · Open source", the official store links, MIT license.                                                                                                                         |

No user counts, ratings, speed figures, badges or store-version claims appear.
