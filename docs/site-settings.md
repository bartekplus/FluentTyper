# Make each site feel right

[FluentTyper](../README.md) / Site settings

Use popup suggestions on one website and inline suggestions on another. Choose a different writing language where you need it.

## Change settings for the current site

1. Open the website you want to change.
2. Select the FluentTyper icon in your browser toolbar.
3. Turn on **Use site profile**.
4. Open **Customize for this site**.
5. Choose the settings you want.

The popup saves changes as you make them. A site profile applies to that website's domain.

| Setting                        | Use it to…                                                             |
| ------------------------------ | ---------------------------------------------------------------------- |
| **Site Language**              | Choose the writing language for this site.                             |
| **Suggestions Count**          | Change how many suggestions appear.                                    |
| **Inline Mode**                | Show a completion beside the cursor instead of a popup list.           |
| **Prefer native autocomplete** | Let the website's own suggestions take priority.                       |
| **Code mode**                  | Use the site's code-mode preference. Review does not run in code mode. |

Where available, choose the option to use global settings to keep a setting shared with your other websites.
The site's language remains the language selected in its profile.

## Return to global settings

Turn off **Use site profile** in the popup. FluentTyper removes that site's profile and uses your global settings again.

For settings across websites, select **Settings** in the popup. You can also manage saved profiles there.

## Pause FluentTyper on a site

Use the popup's current-site control to enable or disable FluentTyper for that domain.
The global **Enable FluentTyper** switch controls the extension across sites.

A profile does not override these switches. FluentTyper remains off on a blocked site, even when that site has a profile.
Browser access restrictions can also prevent FluentTyper from running.

## If suggestions do not appear

See [typing help](typing.md#if-suggestions-do-not-appear).

<details>
<summary>For developers: configuration order</summary>

1. Check the global enable switch.
2. Check the domain allow/block setting.
3. Apply profile overrides when FluentTyper can run on the domain.

The profile always overrides `language`. Optional overrides are `inline_suggestion`, `numSuggestions`, `preferNativeAutocomplete`, and `codeMode`.
An absent optional value inherits the global setting. See [SiteProfile](../src/core/domain/siteProfiles.ts) for the contract.

</details>

---

[Popup and inline suggestions](typing.md) · [Writing languages](review-language-matrix.md) · [Return to FluentTyper](../README.md)
