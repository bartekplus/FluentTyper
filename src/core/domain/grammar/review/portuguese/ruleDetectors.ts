// The named Review detectors of grammar/rules/pt_BR.yaml. The rule file holds the code of every
// Portuguese rule, so no named detector, fix or filter is left. review/reviewDetectors.ts reads
// these empty records.
const NONE: Readonly<Record<string, never>> = {};
export { NONE as PREDICATES, NONE as FIXERS, NONE as FILTERS };
