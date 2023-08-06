
#!/usr/bin/env sh

set -eu

MAX_FILES=25
SCRIPT_DIR=$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )
source ${SCRIPT_DIR}/langs.sh
OSCAR_CORUPS_VERSION="OSCAR-2301"
LANGUAGE_DETECTION_PROB="0.9"
HARMFUL_SCORE="200.0"

cd ${SCRIPT_DIR}
if [ ! -d ${OSCAR_CORUPS_VERSION} ]; then
    GIT_LFS_SKIP_SMUDGE=1 git clone https://huggingface.co/datasets/oscar-corpus/${OSCAR_CORUPS_VERSION}
fi

cd ${OSCAR_CORUPS_VERSION}
WORK_DIR="${SCRIPT_DIR}/tmp"
mkdir -p ${WORK_DIR}
git lfs install

for lang in "${LANGS[@]}"
do
    if [ "$lang" = "hr" ]; then
        echo "Low quality HR dataset, skipping"
        continue
    fi

    SENTENCES_FILE="${WORK_DIR}/${lang}_sentences.txt"
    rm -rf ${SENTENCES_FILE}
    for i in $(seq 1 1 $MAX_FILES)
    do
        FILE_NAME="${lang}_meta_part_${i}.jsonl"
        FILE_PATH="${lang}_meta/${FILE_NAME}"
        echo "Downloading ${FILE_PATH}.zst"
        git lfs pull --include "${FILE_PATH}.zst"
        if [ ! -f "${FILE_PATH}.zst" ]; then
            echo "${FILE_PATH}.zst not found"
            continue
        fi
        if [ ! -f ${FILE_PATH} ]; then
            echo "Decompressing ${FILE_PATH}.zst"
            unzstd "${FILE_PATH}.zst"
        fi
        # Filter content
        echo "Extracting data from ${FILE_PATH}"
        jq -r 'select( .metadata.quality_warnings == null) |
            select ( .metadata.identification.prob >= '${LANGUAGE_DETECTION_PROB}') |
            select ( .metadata.harmful_pp >= '${HARMFUL_SCORE}') |
            .content ' \
            ${FILE_PATH} >> "${WORK_DIR}/${lang}_sentences.txt"
        rm -rf ${FILE_PATH}
        # Spell check if 
    done
    echo "Running spellcheck"
    hunspell -i utf-8 -d ${LANGS_HUNSPELL[${lang}]} -G -L "${WORK_DIR}/${lang}_sentences.txt" > "${WORK_DIR}/${lang}_sentences_checked.txt"
    python3 ${SCRIPT_DIR}/gen_ngram.py -i "${WORK_DIR}/${lang}_sentences_checked.txt" -l en

    python3 ${SCRIPT_DIR}/ngramtxt2marisa.py --overwrite --output ${SCRIPT_DIR}/../resources_js/${lang}/ngrams_db/ --inputfile "${WORK_DIR}/${lang}_sentences_checked_merged.txt"
done