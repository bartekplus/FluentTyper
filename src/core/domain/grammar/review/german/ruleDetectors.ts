// The named Review code of grammar/rules/de.yaml. The German rules are code in the rule file;
// only the unit fixers that common.yaml names ("de:gluedUnit", "de:spacedDegree") stay here.
import {
  mergePredicates,
  type Detector,
  type Fixer,
  type FindingsFilter,
} from "../../engine/reviewRules";
import * as numbers from "./numbers";

export const PREDICATES = mergePredicates<Detector>();

/** The named frame fixes that grammar/rules/common.yaml gives as "de:<name>". */
export const FIXERS = mergePredicates<Fixer>(numbers.FIXERS);

export const FILTERS = mergePredicates<FindingsFilter>();
