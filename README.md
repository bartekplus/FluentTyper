<p align="center">
  <img src="public/icon/icon128.png" width="72" height="72" alt="">
</p>

<h1 align="center">FluentTyper</h1>

<p align="center"><strong>Less typing. More you.</strong></p>

<p align="center">
  Word suggestions, spelling checks, and shortcuts for the phrases you use most.<br>
  Right where you write. Your text stays on your device.
</p>

<p align="center">
  <a href="https://chrome.google.com/webstore/detail/fluenttyper-autocomplete/mbjlobpodpimgbkmlmjiblnmfgajmebm"><strong>Get for Chrome</strong></a>
  ·
  <a href="https://addons.mozilla.org/en-US/firefox/addon/fluenttyper/"><strong>Get for Firefox</strong></a>
  ·
  <a href="https://microsoftedge.microsoft.com/addons/detail/fluenttyper-autocomplete/ljenfpihmhkddgmjoipinkhflinoofcn"><strong>Get for Edge</strong></a>
</p>

<p align="center"><sub>Works offline · Free and open source</sub></p>

<br>

![FluentTyper Review shows a spelling correction from “teh” to “the”, with Apply and Ignore once controls.](docs/images/review-mode/2-correction-card.png)

<p align="center"><sub>Review in action on a demo page. See the change before you apply it.</sub></p>

## Keep your words moving

**Complete the word. Keep the thought.** Suggestions appear as you type. Choose a word with the arrow keys, then press **Tab** to accept it.

**Make a short phrase go further.** Save a shortcut for a reply, an address, or a phrase you use often.
For example, set `callMe` to expand to “Call me back once you're free”.

**Check before you send.** Open **Review text** to find spelling, grammar, and punctuation issues in your draft.
Choose a correction, ignore it, or use **Fix all safe** for corrections that qualify.

[Explore Review text](docs/review-mode.md)

## Your words stay yours

FluentTyper makes suggestions and checks text on your device. It does not upload your typed content.
Autocomplete and standard Review work offline, with no AI model to download.

Choose where FluentTyper runs. Use site settings to adjust the language and suggestions for each website.

[Explore site settings](docs/site-settings.md)

## Start with your next sentence

1. Install FluentTyper from your browser store above.
2. Select a text field on a supported website.
3. Start typing.

Use **↑** and **↓** to choose a suggestion. Press **Tab** to accept it or **Esc** to dismiss it.

To check a draft, select **Review text** in the extension popup. You can also use the **Review** button beside supported text boxes.
The default keyboard shortcut is **Alt+Shift+R**.

## Write in your language

English · Spanish · French · Croatian · Greek · Swedish · Polish · German · Brazilian Portuguese · Arabic

Available Review checks vary by language. [See language coverage](docs/review-language-matrix.md).

## A few things to know

<details>
<summary><strong>Where can I use FluentTyper?</strong></summary>

FluentTyper works in text fields on most websites, including Google Docs. Some editors support fewer features or do not support FluentTyper.

In Google Docs, start Review from the extension popup or the keyboard shortcut.
See the [Google Docs guide](docs/google-docs-integration.md) for details and limits.

</details>

<details>
<summary><strong>Does FluentTyper use AI?</strong></summary>

Autocomplete and standard Review do not need an AI model.
Optional Local AI for Review is implemented but not yet released, according to the [Local AI status note](docs/local-ai-review.md).

It is designed for Chrome and Edge. It requires a model download after your consent, then processes text on your device.
The download provider receives connection data, such as your IP address, but does not receive your text.

</details>

<details>
<summary><strong>Can it help with measurement spacing?</strong></summary>

FluentTyper can fix spacing between numbers and measurement units in supported prose contexts.
It preserves the number and its precision. It does not convert units.

See the [measurement formatting guide](docs/measurement-formatting.md) for examples and limits.

</details>

## Help make it better

[Report a bug](https://github.com/bartekplus/FluentTyper/issues/new?template=bug_report.yml) ·
[Suggest a feature](https://github.com/bartekplus/FluentTyper/issues/new?template=feature_request.yml) ·
[Support development](https://www.buymeacoffee.com/FluentTyper)

For security concerns, use the [private reporting process](SECURITY.md).

**For developers:** Start with the [contribution guide](CONTRIBUTING.md).
See [build commands](docs/agents/commands.md), [architecture](docs/agents/architecture.md), [testing](docs/agents/testing.md), and [performance](docs/extension-performance.md) for technical details.

---

[MIT license](LICENSE) · Copyright © 2026 Bartosz Tomczyk
