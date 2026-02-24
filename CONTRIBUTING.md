# Contributing to FluentTyper

Thanks for your interest in improving FluentTyper. This document is for developers and contributors.

## Before You Start

- Read the user docs in [README.md](README.md) to understand product behavior.
- Check open issues before starting work: [github.com/bartekplus/FluentTyper/issues](https://github.com/bartekplus/FluentTyper/issues)
- For bugs, use the bug report template: [issues/new/choose](https://github.com/bartekplus/FluentTyper/issues/new/choose)

## Development Setup

### Requirements

- Node.js 24 (matches CI)
- npm

### Local Setup

1. Fork the repository and clone your fork.
2. Install dependencies:
   ```bash
   npm ci
   ```
3. Build the extension:
   ```bash
   npm run build
   ```

## Run Locally in a Browser

Build once:

```bash
npm run build
```

Or run watch mode for iterative development:

```bash
npm run watch
```

To test a Chrome/Edge build specifically:

```bash
PLATFORM=chrome npm run watch
```

Load the unpacked extension from the `build/` directory:

- Chrome/Edge: open extensions page, enable developer mode, choose "Load unpacked", select `build/`
- Firefox: open `about:debugging`, choose "This Firefox", click "Load Temporary Add-on", select `build/manifest.json`

## Quality Checks

Run these before opening a pull request:

```bash
npm run check
npm run test
```

Optional local autofix formatting and linting:

```bash
npm run lint
```

Optional end-to-end tests:

```bash
npm run test:e2e
```

## Branch and PR Workflow

1. Create a branch from `master`.
2. Keep commits focused and descriptive.
3. Open a pull request against `master`.
4. Ensure CI is green (tests and lint checks).
5. Describe what changed, why, and how it was tested.

## Bug Reporting Process

Both users and contributors should report product bugs via GitHub issue forms:

- Issue chooser: [github.com/bartekplus/FluentTyper/issues/new/choose](https://github.com/bartekplus/FluentTyper/issues/new/choose)
- Direct bug form: [bug_report.yml](https://github.com/bartekplus/FluentTyper/issues/new?template=bug_report.yml)

Include these details in every bug report:

- Clear reproduction steps
- Expected result
- Actual result
- Browser and OS
- FluentTyper version
- Screenshots or recordings (if available)

## Feature Request Process

Use GitHub issue forms for feature ideas and product improvements:

- Issue chooser: [github.com/bartekplus/FluentTyper/issues/new/choose](https://github.com/bartekplus/FluentTyper/issues/new/choose)
- Direct feature form: [feature_request.yml](https://github.com/bartekplus/FluentTyper/issues/new?template=feature_request.yml)

Strong feature requests include:

- The user problem and impact
- A concrete proposal
- Alternatives considered
- Browser-specific context

## Security Reporting

Do not disclose vulnerabilities in public issues. Follow [SECURITY.md](SECURITY.md) for private reporting.

## Documentation Contributions

Documentation improvements are welcome. Keep audience separation:

- `README.md`: end-user focused
- `CONTRIBUTING.md`: developer and contribution workflow

When behavior changes, update docs in the same pull request.

## Dependencies

FluentTyper is built with:

- [Tribute](https://github.com/bartekplus/tribute)
- [Presage](https://github.com/bartekplus/presage)
- [Fancier Settings](https://github.com/bartekplus/fancier-settings)

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).

## Sponsorship and Support

If you want to support maintenance and development:

[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-Support-FFDD00?logo=buymeacoffee&logoColor=000000)](https://www.buymeacoffee.com/FluentTyper)
