// The named Review detectors of grammar/rules/es.yaml; the rule file sets their checks,
// languages and order.
import { mergePredicates, type Fixer, type FindingsFilter } from "../../engine/reviewRules";
import * as accents from "./accents";
import * as agreement from "./agreement";
import * as clauses from "./clauses";
import * as commas from "./commas";
import * as confusions from "./confusions";
import * as diacritics from "./diacritics";
import * as frames from "./frames";
import * as porque from "./porque";
import * as prefixes from "./prefixes";
import * as quotes from "./quotes";
import * as typography from "./typography";
import * as verbAccents from "./verbAccents";
import * as verbAgreement from "./verbAgreement";
import * as verbForms from "./verbForms";

export const PREDICATES = mergePredicates(
  confusions.PREDICATES,
  verbForms.PREDICATES,
  prefixes.PREDICATES,
  porque.PREDICATES,
  typography.PREDICATES,
  agreement.PREDICATES,
  commas.PREDICATES,
  verbAgreement.PREDICATES,
  clauses.PREDICATES,
  frames.PREDICATES,
);

/** The named frame fixes of grammar/rules/es.yaml (`fixer:`). */
export const FIXERS = mergePredicates<Fixer>(
  accents.FIXERS,
  diacritics.FIXERS,
  verbAccents.FIXERS,
  prefixes.FIXERS,
  typography.FIXERS,
  quotes.FIXERS,
);

/** The named findings filters of grammar/rules/es.yaml (`filter:`). */
export const FILTERS = mergePredicates<FindingsFilter>(typography.FILTERS);
