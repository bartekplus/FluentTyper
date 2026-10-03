# Site settings

FluentTyper lets you choose where suggestions appear. A site profile lets you use different settings on a particular website.

## Choose where FluentTyper runs

The global **Enable Extension** switch must be on before FluentTyper can run.
The domain allow/block setting then decides whether FluentTyper runs on the current website.

A site profile does not enable FluentTyper on a blocked website.

## Adjust a website's suggestions

A site profile can set the language, inline suggestions, and number of suggestions for its domain.
Without a site profile, FluentTyper uses the global settings.

For an existing profile:

- The profile's language replaces the global language.
- Inline suggestions use the profile setting when present. Otherwise, they use the global setting.
- The number of suggestions uses the profile setting when present. Otherwise, it uses the global setting.

## Configuration reference

For developers, the profile fields are `language`, `inline_suggestion`, and `numSuggestions`.

FluentTyper applies settings in this order:

1. Check the global enable switch.
2. Check the domain allow/block setting.
3. Apply the site profile overrides if FluentTyper can run on the domain.

[Return to FluentTyper](../README.md)
