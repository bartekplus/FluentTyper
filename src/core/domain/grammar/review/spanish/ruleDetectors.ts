// The named Review detectors of grammar/rules/es.yaml; the rule file sets their checks,
// languages and order.
import { mergePredicates, type Fixer, type FindingsFilter } from "../../engine/reviewRules";
import * as accents from "./accents";
import * as agreement from "./agreement";
import * as clauses from "./clauses";
import * as confusions from "./confusions";
import * as diacritics from "./diacritics";
import * as frames from "./frames";
import * as verbAccents from "./verbAccents";
import * as verbAgreement from "./verbAgreement";
import * as verbForms from "./verbForms";

export const PREDICATES = mergePredicates();

/** The named frame fixes of grammar/rules/es.yaml (`fixer:`). */
export const FIXERS = mergePredicates<Fixer>(
  accents.FIXERS,
  diacritics.FIXERS,
  verbAccents.FIXERS,
  confusions.FIXERS,
  verbForms.FIXERS,
  agreement.FIXERS,
  verbAgreement.FIXERS,
  clauses.FIXERS,
  frames.FIXERS,
);

/** The named findings filters of grammar/rules/es.yaml (`filter:`). */
export const FILTERS = mergePredicates<FindingsFilter>(verbAgreement.FILTERS);
