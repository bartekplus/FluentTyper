// The named Review detectors of grammar/rules/es.yaml; the rule file sets their checks,
// languages and order.
import { mergePredicates } from "../../engine/reviewRules";
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
  accents.PREDICATES,
  diacritics.PREDICATES,
  verbAccents.PREDICATES,
  confusions.PREDICATES,
  verbForms.PREDICATES,
  prefixes.PREDICATES,
  porque.PREDICATES,
  typography.PREDICATES,
  agreement.PREDICATES,
  commas.PREDICATES,
  verbAgreement.PREDICATES,
  clauses.PREDICATES,
  quotes.PREDICATES,
  frames.PREDICATES,
);
