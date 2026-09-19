# Measurement grammar data

The measurement registry recognizes prose symbols; it does not convert values or implement UCUM. Exact symbols are case-sensitive. A single SI decimal or IEC binary prefix is expanded only for units that opt in, and exact entries win so ambiguous words such as `in`, `as`, and `Ms` stay unsafe. Written unit names are preserved and are not converted to symbols.

## Pinned sources and licenses

- **BIPM-SI-9-4.01** — _The International System of Units (SI)_, 9th edition, version 4.01 (2026), DOI 10.59161/AUEZ1291. CC BY 4.0. Used for SI symbols, SI prefixes through quetta/quecto, and accepted non-SI units.
- **NIST-SP-811** — _Guide for the Use of the International System of Units (SI)_ (2008), DOI 10.6028/NIST.SP.811e2008. US government work; source credit requested. Used for Chapters 5–7 classifications and US prose conventions.
- **CLDR-48.2** — Unicode CLDR 48.2 / UTS #35 LDML Units, tag `release-48-2`, commit `11299982335beb974c1c63c45265184e759c0f41`. Unicode License v3. Used for locale punctuation, binary data-unit forms, practical unit forms, and the distinction between localized display names and stable identities.
- **UCUM-2.2** — unmodified `ucum-essence.xml` at commit `ef4c31cd7d3bc81de1a1bf2cc8414bf502b6304f`, SHA-256 `dfccea1b5dc284245ebae97edd1dc03c45864da4e87df55bc9851797b4fd0b61`. Copyright ©1999–2024 Regenstrief Institute, Inc.; UCUM License 1.0. The complete pinned copyright notice, license, warranty disclaimer, and liability terms are distributed beside the snapshot as `data/measurement/UCUM-LICENSE.txt`. Used only as the atomic-code coverage baseline. The application makes no UCUM conformance claim.

Machine-readable citations live in `data/measurement/sources.json`. The complete UCUM atom audit is generated at `data/measurement/ucum-coverage.md`; every pinned atom is classified as recognized-safe, recognized-ambiguous, or unsupported. “Recognized” means that the prose registry has an explicit human-facing symbol for the UCUM atom; parser acceptance still depends on the symbol's `safe` and `composition` metadata and grammar tokenization. Unsupported includes clinical, legacy, bracketed customary, expression-syntax, and conversion-oriented codes that are outside prose spacing.

## Offline generation and explicit refresh

Run `bun scripts/measurement-data.ts` to validate curated data and regenerate the TypeScript registry plus the coverage report entirely offline. The pinned UCUM snapshot is committed under `data/measurement/`.

Run `bun scripts/measurement-data.ts --refresh` only when deliberately refreshing the snapshot. The URL contains the reviewed commit, so this command reproduces the pinned file rather than following a moving branch. Update the commit and SHA-256 in the source inventory and this document as part of a separately reviewed source upgrade.

The locale allowlist is exact: `en_US`, `fr_FR`, `hr_HR`, `es_ES`, `el_GR`, `sv_SE`, `de_DE`, `pl_PL`, and `pt_BR`. Hyphenated spellings of the same tags are accepted. Bare languages, `en_GB`, `pt_PT`, and all unknown locales fail closed. Every policy inserts U+00A0 NO-BREAK SPACE between the number and unit; decimal marks remain locale-specific.

The binary prefix inventory follows BIPM v4.01, page 139, including robi (Ri) and quebi (Qi), which references IEC 80000-13:2025. The curated entries are adapted factual subsets with FluentTyper-specific ambiguity flags, not publisher-endorsed autocorrection decisions. BIPM credit: Bureau International des Poids et Mesures, [SI Brochure v4.01](https://www.bipm.org/documents/20126/41483022/SI-Brochure-9-EN.pdf), adapted under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The complete Unicode notice is in `data/measurement/UNICODE-LICENSE.txt`; the CLDR pin is the dereferenced commit of annotated tag `release-48-2`.
