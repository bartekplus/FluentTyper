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

if [ "$LANG" = "pt_BR" ]; then
  trap 'rm -rf ${WORK_DIR}' SIGINT SIGTERM EXIT
  WORK_DIR=`mktemp -d`
  cd ${WORK_DIR}
  # Download dictionary
  chronic wget -q https://pt-br.libreoffice.org/assets/Uploads/PT-BR-Documents/VERO/ptBR-2013-10-30AOC-2.zip -O ./dict.zip
  unzip dict.zip
  cp "${LANG}.aff" "${DEST_DIR}/${LANG}.aff"
  cp "${LANG}.dic" "${DEST_DIR}/${LANG}.dic"
else
# Download dictionary
  if [[ `wget -S --spider https://raw.githubusercontent.com/wooorm/dictionaries/main/dictionaries/${LANG}/index.aff  2>&1 | grep 'HTTP/1.1 200 OK'` ]]; then
    chronic wget -timeout=10 -q "https://raw.githubusercontent.com/wooorm/dictionaries/main/dictionaries/${LANG}/index.aff" -O "${DEST_DIR}/${LANG}.aff"
    chronic wget -timeout=10 -q "https://raw.githubusercontent.com/wooorm/dictionaries/main/dictionaries/${LANG}/index.dic" -O "${DEST_DIR}/${LANG}.dic"
  else
    # Try with just a country code
    LANG_SHORT="${LANG:0:2}"
    chronic wget -timeout=10 -q "https://raw.githubusercontent.com/wooorm/dictionaries/main/dictionaries/${LANG_SHORT}/index.aff" -O "${DEST_DIR}/${LANG}.aff"
    chronic wget -timeout=10 -q "https://raw.githubusercontent.com/wooorm/dictionaries/main/dictionaries/${LANG_SHORT}/index.dic" -O "${DEST_DIR}/${LANG}.dic"
  fi
fi
