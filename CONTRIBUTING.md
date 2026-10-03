# Build something useful

[FluentTyper](README.md) / Contributing

Help improve writing assistance that keeps text local and works offline.
This guide takes you from a checkout to a pull request.

## Choose your starting point

| I want to…                 | Read                                                              |
| -------------------------- | ----------------------------------------------------------------- |
| Understand the product     | [User guide](README.md)                                           |
| Fix a bug or add a feature | Start with the setup below.                                       |
| Find the right code        | [Architecture](docs/agents/architecture.md)                       |
| Change runtime behavior    | [Feature workflows](docs/agents/runtime-features.md)              |
| Measure resource use       | [Performance guide](docs/extension-performance.md)                |
| Report a vulnerability     | [Private security reporting](SECURITY.md#report-a-security-issue) |

Check [open issues](https://github.com/bartekplus/FluentTyper/issues) before starting substantial work.
Keep changes focused. Preserve unrelated work in your checkout.

## Run the extension locally

Use **Bun 1.4.2**, as pinned in `package.json`. `bun.lock` is the canonical lockfile.
Run commands from the repository root.

1. Fork the repository.
2. Clone your fork.
3. Create a branch from `master`.
4. Install dependencies:

   ```sh
   bun install --frozen-lockfile
   ```

5. Build for your browser:

   ```sh
   bun run build                   # Chrome
   bun run build --platform=edge   # Edge
   bun run build --platform=firefox # Firefox
   ```

6. Load the output from `build/`:

   - Chrome or Edge: enable Developer mode on the extensions page, then select **Load unpacked**.
   - Firefox: open `about:debugging`, select **This Firefox**, then load `build/manifest.json` as a temporary add-on.

Use `bun run watch` for a development build that updates when source files change.
See [build commands](docs/agents/commands.md) for release builds, browser loading, and generated assets.

## Keep these boundaries

- Keep typed content local. Do not add telemetry or external uploads.
- Keep core features usable offline.
- Do not add permissions without an explicit maintainer request.
- Preserve Chrome, Edge, and Firefox platform differences.
- Follow the [layer and import rules](docs/agents/architecture.md).
- Never log reviewed text. Keep development traces out of production builds.

Autocomplete uses Presage. Optional Local AI belongs to Review and must not become a requirement for ordinary typing or standard Review.

## Check your change

Run every baseline check before opening or updating a pull request:

```sh
bun run check
bun run test
bun run test:e2e
bun run check:e2e:coverage
```

Runtime changes also require the relevant Chrome, Firefox, and development suites.
The [testing guide](docs/agents/testing.md) defines those requirements and the coverage policy.
Every bug fix needs a regression test that fails without the fix.

Use `bun run fix` to apply lint and formatting fixes. Review the resulting diff before committing.

## Prepare the pull request

1. Update the relevant documentation when behavior changes.
2. Keep commits focused and descriptive.
3. Open the pull request against `master`.
4. Describe the user-visible change and list the checks you ran.
5. Include screenshots when a UI change needs visual evidence.
6. Resolve failing CI checks before merging.

User documentation should explain tasks, expected results, and limits.
Place implementation detail in a linked reference or a guide under `docs/agents/`.

## Specialized work

- **Grammar or Review:** Follow the [runtime workflow](docs/agents/runtime-features.md#review-text) and [Review reference](docs/review-reference.md#architecture).
- **Language assets:** Use the [rebuild procedure](docs/agents/commands.md#rebuilding-language-assets-presage-data).
- **Versions and releases:** Use the [versioning procedure](docs/agents/commands.md#versioning). Do not hand-edit manifest versions.
- **Performance:** Start with the [local smoke workload](docs/extension-performance.md). Keep synthetic and live-site evidence separate.
- **README screenshots:** Build the extension, then run `bun scripts/readme-demo.ts`. The script uses local example text and checks acceptance.

<details>
<summary>If the Chrome test browser cannot start</summary>

If the error names a missing “Google Chrome for Testing Framework”, the browser installation may be incomplete.
Check the browser path under `~/.cache/puppeteer/chrome` and the downloaded archive before replacing that version's extracted directory.
Re-extract the matching archive, then repeat the test. Do not remove unrelated browser versions or personal profiles.

</details>

## Project foundations

FluentTyper uses [Presage](https://github.com/bartekplus/presage), [Tribute](https://github.com/bartekplus/tribute), and [Fancier Settings](https://github.com/bartekplus/fancier-settings).
By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).

[Report a bug](https://github.com/bartekplus/FluentTyper/issues/new?template=bug_report.yml) · [Suggest a feature](https://github.com/bartekplus/FluentTyper/issues/new?template=feature_request.yml) · [Support development](https://www.buymeacoffee.com/FluentTyper)
