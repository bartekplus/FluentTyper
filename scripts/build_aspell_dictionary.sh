#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR=$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )

usage() { 
    echo "Usage: $0 [options...]"
    echo
    echo -e "-u\URL to aspell dictionary"
    echo -e "-d\Destination installation directory"
    echo
    exit 0
}

[ $# -eq 0 ] && usage

while getopts ":hu:d:" arg; do
  case $arg in
    u)
      URL=${OPTARG}
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

trap 'rm -rf ${WORK_DIR}' SIGINT SIGTERM EXIT

# Make dest dir
mkdir -p ${DEST_DIR}

# Create temporary WORK DIR
WORK_DIR=`mktemp -d`
cd ${WORK_DIR}
# Download dictionary
chronic wget -timeout=10 -q ${URL} -O ./dict.rpm
#extract 
tar -zxf dict.rpm
# Copy
cp -H ./usr/lib/aspell-0.60/* ${DEST_DIR} || true
cp  ./var/lib/aspell-0.60/* ${DEST_DIR} || true
