#!/usr/bin/env bash

set -eu

SCRIPT_DIR=$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )

# rebuild
${SCRIPT_DIR}/rebuild_ngram_db.sh
${SCRIPT_DIR}/rebuild_libpresage.sh

# repack stuff

BUILD_CMD=""
