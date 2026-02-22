#!/usr/bin/env bash

set -euo pipefail

MAX_FILES=1
SCRIPT_DIR=$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )
OSCAR_REPO_NAME="community-oscar"
OSCAR_CORUPS_VERSION="2024-38"
LANGUAGE_DETECTION_PROB="0.975"
HARMFUL_SCORE="300.0"
CACHE_DIR="${SCRIPT_DIR}/.cache/oscar_processed"
LANG=""
LANG_VARIANT=""

usage() { 
    echo "Usage: $0 [options...]"
    echo
    echo -e "-l\tset language"
    echo -e "-v\tset language variant"
    echo
    exit 0
}

[ $# -eq 0 ] && usage

while getopts ":hl:v:" arg; do
  case $arg in
    l)
      LANG=${OPTARG}
      ;;
    v)
      LANG_VARIANT=${OPTARG}
      ;;
    h | *) # Display help.
      usage
      exit 0
      ;;
  esac
done

# Check if the 'nproc' command is available (Linux)
if command -v nproc >/dev/null 2>&1; then
  num_cpus=$(nproc)
# Check if the 'sysctl' command is available (macOS)
elif command -v sysctl >/dev/null 2>&1; then
  num_cpus=$(sysctl -n hw.ncpu)
else
  echo "Unable to determine the number of CPUs."
  exit 1
fi
# Num CPUs minus 1
if [ "$num_cpus" -gt 1 ]; then
  num_cpus=$((num_cpus - 1))
else
  num_cpus=1
fi

trap 'trap - SIGTERM && jobs -p | xargs -r kill' SIGINT SIGTERM

waitforjobs() {
    while test $(jobs -p | wc -w) -ge "$1"; do wait -n; done
}

download_and_extract() {
    FILE_PATH=$1
    WORK_DIR=$3
    FILE_INDEX=$4

    OUTPUT_FILE="${WORK_DIR}/${LANG}_sentences_checked_${FILE_INDEX}.txt"
    CACHE_FILE="${CACHE_DIR}/${OSCAR_CORUPS_VERSION}_${LANG}_${LANG_VARIANT}_${FILE_INDEX}.txt"

    if [ -s "${CACHE_FILE}" ]; then
        echo "Using cached data for ${FILE_PATH}"
        cp "${CACHE_FILE}" "${OUTPUT_FILE}"
        return 0
    fi

    git lfs pull --include "${FILE_PATH}.zst"
    if [ ! -f "${FILE_PATH}.zst" ]; then
        echo "${FILE_PATH}.zst not found"
        return 0
    fi

    waitforjobs ${num_cpus}

    # Extract, filter, and spellcheck directly from stream
    echo "Extracting and filtering data from ${FILE_PATH}.zst"
    unzstd -c "${FILE_PATH}.zst" | \
    jq --argjson prob "${LANGUAGE_DETECTION_PROB}" --argjson harmful "${HARMFUL_SCORE}" -r \
        'select(.metadata.quality_warnings == null and .metadata.identification.prob >= $prob and .metadata.harmful_pp >= $harmful) | .content' | \
    awk 'NF>=3' | \
    grep -vE "http[s]?://|www\.|<[^>]+>|[0-9]{4,}|[_=@#%^*+~\|/]{2,}|{}" | \
    DICPATH="${SCRIPT_DIR}"/../resources_js/"${LANG_VARIANT}"/hunspell hunspell -i utf-8 -d "${LANG_VARIANT}" -G -L > "${CACHE_FILE}" && \
    cp "${CACHE_FILE}" "${OUTPUT_FILE}" && \
    rm -f "${FILE_PATH}.zst" &
}

if [ "$LANG" = "hr" ]; then
    echo "Low quality HR dataset, skipping"
    exit 0
fi

cd "${SCRIPT_DIR}"
if [ ! -d ${OSCAR_REPO_NAME} ]; then
    GIT_LFS_SKIP_SMUDGE=1 git clone ssh://git@hf.co/datasets/oscar-corpus/community-oscar
fi

cd ${OSCAR_REPO_NAME}
WORK_DIR="${SCRIPT_DIR}/tmp"
mkdir -p "${WORK_DIR}" "${CACHE_DIR}"
trap 'rm -rf ${WORK_DIR}' SIGINT SIGTERM EXIT

git lfs install

FILE_COUNT=$(ls "data/${OSCAR_CORUPS_VERSION}/${LANG}"_meta/"${LANG}"_meta_part_*.zst |wc -l)
if [[ "${FILE_COUNT}" -lt "${MAX_FILES}" ]]; then
  MAX_FILES_TO_PROCESS="${FILE_COUNT}"
else
  MAX_FILES_TO_PROCESS="${MAX_FILES}"
fi
FILE_STEP=$((${FILE_COUNT} / ${MAX_FILES_TO_PROCESS}))
FILE_MAX=$((${FILE_STEP} * ${MAX_FILES_TO_PROCESS}))

SENTENCES_FILE="${WORK_DIR}/${LANG}_sentences.txt"
rm -rf "${SENTENCES_FILE}"

for i in $(seq 1 $FILE_STEP $FILE_MAX)
do
    FILE_NAME="${LANG}_meta_part_${i}.jsonl"
    FILE_PATH="data/${OSCAR_CORUPS_VERSION}/${LANG}_meta/${FILE_NAME}"
    echo "Processing ${FILE_PATH}"
    download_and_extract "$FILE_PATH" "$LANG" "$WORK_DIR" "$i"
done    

echo "Waiting for download background jobs to complete"
wait

# Merge spellchecked files
cat "${WORK_DIR}"/"${LANG}"_sentences_checked_*.txt > "${WORK_DIR}/${LANG}_sentences_checked.txt"
rm -rf "${WORK_DIR}"/"${LANG}"_sentences_checked_*.txt 

# Generate ngrams 
"${SCRIPT_DIR}"/gen_ngram.py -i "${WORK_DIR}/${LANG}_sentences_checked.txt" -l ${LANG}
# generate marisa-trie database from ngrams
"${SCRIPT_DIR}"/ngramtxt2marisa.py --overwrite --output "${SCRIPT_DIR}"/../resources_js/"${LANG_VARIANT}"/ngrams_db/ --inputfile "${WORK_DIR}/${LANG}_sentences_checked_ngram_merged.txt"

echo "✅ N-gram DB successfully generated."
echo "If you want to package it for extension use, run:"
echo "  ./rebuild_libpresage.sh --package --link"

git lfs prune
