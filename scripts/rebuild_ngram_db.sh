#!/usr/bin/env bash

set -euo pipefail

MAX_FILES=1
SCRIPT_DIR=$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )
OSCAR_CORUPS_VERSION="OSCAR-2301"
LANGUAGE_DETECTION_PROB="0.925"
HARMFUL_SCORE="275.0"
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

    if [ ! -f "${FILE_PATH}" ]; then
        git lfs pull --include "${FILE_PATH}.zst"
        if [ ! -f "${FILE_PATH}.zst" ]; then
            echo "${FILE_PATH}.zst not found"
            return 0
        fi
        echo "Decompressing ${FILE_PATH}.zst"
        unzstd "${FILE_PATH}.zst"
    fi

    waitforjobs ${num_cpus}

    # Filter content
    echo "Extracting data from ${FILE_PATH}"
    jq -r 'select( .metadata.quality_warnings == null) |
        select ( .metadata.identification.prob >= '${LANGUAGE_DETECTION_PROB}') |
        select ( .metadata.harmful_pp >= '${HARMFUL_SCORE}') |
        .content ' \
    "${FILE_PATH}" >> "${WORK_DIR}/${LANG}_sentences_${i}.txt" && \
    DICPATH="${SCRIPT_DIR}"/../resources_js/"${LANG_VARIANT}"/hunspell hunspell -i utf-8 -d "${LANG_VARIANT}" -G -L "${WORK_DIR}/${LANG}_sentences_${i}.txt" >  "${WORK_DIR}/${LANG}_sentences_checked_${i}.txt"  && \
    rm -rf "${WORK_DIR}/${LANG}_sentences_${i}.txt" &
}

if [ "$LANG" = "hr" ]; then
    echo "Low quality HR dataset, skipping"
    exit 0
fi

cd "${SCRIPT_DIR}"
if [ ! -d ${OSCAR_CORUPS_VERSION} ]; then
    GIT_LFS_SKIP_SMUDGE=1 git clone https://huggingface.co/datasets/oscar-corpus/${OSCAR_CORUPS_VERSION}
fi

cd ${OSCAR_CORUPS_VERSION}
WORK_DIR="${SCRIPT_DIR}/tmp"
mkdir -p "${WORK_DIR}"
trap 'rm -rf ${WORK_DIR}' SIGINT SIGTERM EXIT

git lfs install

FILE_COUNT=$(ls "${LANG}"_meta/"${LANG}"_meta_part_*.zst |wc -l)
FILE_STEP=$((${FILE_COUNT} / ${MAX_FILES}))
FILE_MAX=$((${FILE_STEP} * ${MAX_FILES}))

SENTENCES_FILE="${WORK_DIR}/${LANG}_sentences.txt"
rm -rf "${SENTENCES_FILE}"

for i in $(seq 1 $FILE_STEP $FILE_MAX)
do
    FILE_NAME="${LANG}_meta_part_${i}.jsonl"
    FILE_PATH="${LANG}_meta/${FILE_NAME}"
    download_and_extract "$FILE_PATH" "$LANG" "$WORK_DIR"
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

git lfs prune
