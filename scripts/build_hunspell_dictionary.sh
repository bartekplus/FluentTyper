#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR=$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )

URL=https://raw.githubusercontent.com/wooorm/dictionaries/main/dictionaries/

usage() { 
    echo "Usage: $0 [options...]"
    echo
    echo -e "-l\Lang"
    echo -e "-d\Destination installation directory"
    echo
    exit 0
}

[ $# -eq 0 ] && usage

while getopts ":hl:d:" arg; do
  case $arg in
    l)
      LANG=${OPTARG}
      ;;
    d)
      DEST_DIR=${OPTARG}
      ;;
    h | *) # Display help.
      usage
      exit 0
      ;;
  esac
done


# Make dest dir
mkdir -p ${DEST_DIR}
# Download dictionary
chronic wget -q "https://raw.githubusercontent.com/wooorm/dictionaries/main/dictionaries/${LANG}/index.aff" -O "${DEST_DIR}/${LANG}.aff"
chronic wget -q "https://raw.githubusercontent.com/wooorm/dictionaries/main/dictionaries/${LANG}/index.dic" -O "${DEST_DIR}/${LANG}.dic"