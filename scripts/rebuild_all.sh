#!/usr/bin/env bash

set -eu

SCRIPT_DIR=$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )

declare -A SUPPORTED_LANGUAGES=(
  [en]="en_US"
  [fr]="fr_FR"
  [hr]="hr_HR"
  [es]="es_ES"
  [el]="el_GR"
  [sv]="sv_SE"
  [de]="de_DE"
  [pl]="pl_PL"
  [pt]="pt_BR"
)

for lang_short in "${!SUPPORTED_LANGUAGES[@]}"; do
  lang_variant="${SUPPORTED_LANGUAGES[$lang_short]}"
  echo "Starting rebuild for language: ${lang_short}, variant: ${lang_variant}"
  "${SCRIPT_DIR}"/rebuild_ngram_db.sh -l "${lang_short}" -v "${lang_variant}"
done

# rebuild
"${SCRIPT_DIR}"/rebuild_libpresage.sh

# repack stuff

BUILD_CMD=""
