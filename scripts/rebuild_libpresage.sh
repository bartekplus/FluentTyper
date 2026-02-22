#!/usr/bin/env bash

set -euo pipefail

DEBUG=false
CWD=$(pwd)
SCRIPT_DIR=$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )
BUILD_DIR="${SCRIPT_DIR}/.deps"
export CXXFLAGS="-O3"
export CFLAGS="-O3"

usage() {
    echo "Usage: $0 [options]"
    echo ""
    echo "Options:"
    echo "  -d, --debug   Enable debug mode"
    echo "  -h, --help    Display this help message"
    echo "  --deps        Build dependencies (Hunspell, Aspell, Marisa-trie)"
    echo "  --presage     Build Presage library"
    echo "  --package     Package data files"
    echo "  --link        Link everything into libpresage.js"
    echo "  --all         Perform all steps (default if no specific step is provided)"
}

BUILD_DEPS=false
BUILD_PRESAGE=false
PACKAGE_DATA=false
LINK_LIB=false

while [[ $# -gt 0 ]]; do
  case $1 in
    -d|--debug)
      DEBUG=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    --deps)
      BUILD_DEPS=true
      shift
      ;;
    --presage)
      BUILD_PRESAGE=true
      shift
      ;;
    --package)
      PACKAGE_DATA=true
      shift
      ;;
    --link)
      LINK_LIB=true
      shift
      ;;
    --all)
      BUILD_DEPS=true
      BUILD_PRESAGE=true
      PACKAGE_DATA=true
      LINK_LIB=true
      shift
      ;;
    *)
      echo "Unknown option $1"
      usage
      exit 1
      ;;
  esac
done

if [ "$BUILD_DEPS" = false ] && [ "$BUILD_PRESAGE" = false ] && [ "$PACKAGE_DATA" = false ] && [ "$LINK_LIB" = false ]; then
  BUILD_DEPS=true
  BUILD_PRESAGE=true
  PACKAGE_DATA=true
  LINK_LIB=true
fi

mkdir -p "${BUILD_DIR}"

if [ "$BUILD_DEPS" = true ]; then
    echo "=== Building Dependencies ==="
    
    # HUNSPELL
    echo "Building HUNSPELL"
    BUILD_DIR_HUNSPELL="${BUILD_DIR}/hunspell"
    export LIBTOOLIZE=glibtoolize

    if [ ! -d "${BUILD_DIR_HUNSPELL}" ]; then
        cd "${BUILD_DIR}"
        chronic git clone --depth 1 --branch v1.7.2 git@github.com:hunspell/hunspell.git
        cd "${BUILD_DIR_HUNSPELL}"
        chronic emconfigure autoreconf -vfi
        chronic emconfigure ./configure --enable-static=yes  --enable-shared=no --host=i686-gnu 
    fi

    cd "${BUILD_DIR_HUNSPELL}"
    chronic emmake make -j

    # Workaround lib name issue
    rm -rf "${BUILD_DIR_HUNSPELL}"/src/hunspell/.libs/libhunspell.*
    cp "${BUILD_DIR_HUNSPELL}"/src/hunspell/.libs/libhunspell-1.7.a "${BUILD_DIR_HUNSPELL}"/src/hunspell/.libs/libhunspell.a
    cp "${BUILD_DIR_HUNSPELL}"/src/hunspell/.libs/libhunspell-1.7.la "${BUILD_DIR_HUNSPELL}"/src/hunspell/.libs/libhunspell.la
    cp "${BUILD_DIR_HUNSPELL}"/src/hunspell/.libs/libhunspell-1.7.lai "${BUILD_DIR_HUNSPELL}"/src/hunspell/.libs/libhunspell.lai

    echo "HUNSPELL built"

    # ASPELL
    echo "Building ASPELL"
    BUILD_DIR_ASPELL="${BUILD_DIR}/aspell"

    if [ ! -d "${BUILD_DIR_ASPELL}" ]; then
        cd "${BUILD_DIR}"
        chronic git clone --depth 1 git@github.com:GNUAspell/aspell.git
        cd "${BUILD_DIR_ASPELL}"
        chronic emconfigure ./autogen
        chronic emconfigure ./configure --enable-static=yes  --enable-shared=no --host=i686-gnu 
    fi

    cd "${BUILD_DIR_ASPELL}"
    chronic emmake make -j
    echo "ASPELL built"

    # MARISA-TRIE
    echo "Building MARISA-TRIE"
    BUILD_DIR_MARISA_TRIE="${BUILD_DIR}/marisa-trie"

    if [ ! -d "${BUILD_DIR_MARISA_TRIE}" ]; then
        cd "${BUILD_DIR}"
        chronic git clone --depth 1 --branch v0.2.6 git@github.com:s-yata/marisa-trie.git
        cd "${BUILD_DIR_MARISA_TRIE}"
        chronic emconfigure autoreconf -i
        chronic emconfigure ./configure  --disable-shared --host=i686-gnu 
    fi

    cd "${BUILD_DIR_MARISA_TRIE}"
    chronic emmake make -j
    echo "MARISA-TRIE built"
fi

if [ "$BUILD_PRESAGE" = true ]; then
    echo "=== Building PRESAGE ==="
    BUILD_DIR_MARISA_TRIE="${BUILD_DIR}/marisa-trie"
    BUILD_DIR_HUNSPELL="${BUILD_DIR}/hunspell"
    BUILD_DIR_ASPELL="${BUILD_DIR}/aspell"
    BUILD_DIR_PRESAGE="${BUILD_DIR}/presage"
    export CXXFLAGS="-O2 -std=c++17"
    export CPPFLAGS="-I${BUILD_DIR_MARISA_TRIE}/include -I${BUILD_DIR_HUNSPELL}/src -I${BUILD_DIR_ASPELL}/interfaces/cc/"
    export LDFLAGS="--bind -L${BUILD_DIR_MARISA_TRIE}/lib/marisa/.libs -L${BUILD_DIR_HUNSPELL}/src/hunspell/.libs -L${BUILD_DIR_ASPELL}/.libs"

    if [ ! -d "${BUILD_DIR_PRESAGE}" ]; then
        cd "${BUILD_DIR}"
        chronic git clone --depth 1 git@github.com:bartekplus/presage.git 2> /dev/null
        cd "${BUILD_DIR_PRESAGE}"
        chronic emconfigure autoreconf -i -f
        chronic emconfigure ./bootstrap
        chronic emconfigure ./configure --host=i686-gnu  --disable-python-binding --disable-gprompter --disable-gpresagemate --disable-sqlite --enable-shared
    fi

    cd "${BUILD_DIR_PRESAGE}"
    chronic emmake make -C src/lib -j
    echo "PRESAGE built"
fi

BUILD_CMD=""
GEN_DIR="${BUILD_DIR}/gen"
mkdir -p "${GEN_DIR}"

if [ "$PACKAGE_DATA" = true ] || [ "$LINK_LIB" = true ]; then
    # We do the generation in a dedicated directory to avoid polluting the source tree
    cd "${GEN_DIR}"
    VERSION_INFO="$(emcc -v 2>&1)"
    VER=$(echo "$VERSION_INFO" | grep -oE -m 1 '[0-9]+\.[0-9]+\.[0-9]+')
    
    # Try to find file_packager.py in emcc directory first, fallback to homebrew structure
    EMCC_DIR=$(dirname "$(command -v emcc || echo '')")
    if [ -f "${EMCC_DIR}/tools/file_packager.py" ]; then
        FILE_PACKAGER_PY="${EMCC_DIR}/tools/file_packager.py"
    else
        FILE_PACKAGER_PY="/opt/homebrew/Cellar/emscripten/${VER}/libexec/tools/file_packager.py"
    fi

    for dir_path in ${SCRIPT_DIR}/../resources_js/*/ ;
    do
        # Ensure it's a directory
        [ -d "${dir_path}" ] || continue
        
        dir=$(basename "$dir_path")
        if [ "$PACKAGE_DATA" = true ]; then
            echo "Packaging data for ${dir}"
            python3 "${FILE_PACKAGER_PY}" "${dir}.data" --preload "${SCRIPT_DIR}/../resources_js/${dir}@/resources_js/${dir}" --js-output="${dir}.js"
            
            # Patch fetch(packageName) to fetch(chrome.runtime.getURL("third_party/libpresage/" + packageName))
            python3 -c "
import sys
content = open(sys.argv[1], 'r').read()
old_fetch = 'fetch(packageName)'
new_fetch = 'fetch(chrome.runtime.getURL(\"third_party/libpresage/\" + packageName))'
if old_fetch in content:
    content = content.replace(old_fetch, new_fetch)
else:
    print('Warning: Could not find strict fetch(packageName) in', sys.argv[1])
open(sys.argv[1], 'w').write(content)
" "${dir}.js"

            mkdir -p "${SCRIPT_DIR}/../public/third_party/libpresage/"
            cp "${dir}.data" "${SCRIPT_DIR}/../public/third_party/libpresage/"
        fi
        BUILD_CMD="${BUILD_CMD} --pre-js ${dir}.js"
    done
fi

if [ "$LINK_LIB" = true ]; then
    echo "=== Linking ==="
    BUILD_DIR_MARISA_TRIE="${BUILD_DIR}/marisa-trie"
    BUILD_DIR_HUNSPELL="${BUILD_DIR}/hunspell"
    BUILD_DIR_ASPELL="${BUILD_DIR}/aspell"
    BUILD_DIR_PRESAGE="${BUILD_DIR}/presage"
    export LDFLAGS="--bind -L${BUILD_DIR_MARISA_TRIE}/lib/marisa/.libs -L${BUILD_DIR_HUNSPELL}/src/hunspell/.libs -L${BUILD_DIR_ASPELL}/.libs"

    if [ "$DEBUG" = true ] ; then
        COMPILE_OPTIONS=" -O0 -sASSERTIONS -sNO_DISABLE_EXCEPTION_CATCHING "
    else
        COMPILE_OPTIONS=" -O3 -s NO_EXIT_RUNTIME=1 "
    fi

    cd "${GEN_DIR}"
    emcc "${BUILD_DIR_PRESAGE}"/src/lib/.libs/libpresage.so.1.1.1 -o libpresage.js -s ALLOW_MEMORY_GROWTH=1 \
        ${LDFLAGS} ${COMPILE_OPTIONS} \
        -lhunspell -laspell -lmarisa \
        -s "EXPORTED_RUNTIME_METHODS=['FS']" -s MODULARIZE=1 -s ENVIRONMENT=web -s TEXTDECODER=1 -s EXPORT_ES6=1  \
        --llvm-lto 1 -sFORCE_FILESYSTEM  -s NO_DYNAMIC_EXECUTION=1 \
        ${BUILD_CMD} \
        -sSTACK_SIZE=5MB

    mkdir -p "${SCRIPT_DIR}/../src/third_party/libpresage/"
    cp libpresage.js libpresage.wasm "${SCRIPT_DIR}/../src/third_party/libpresage/"
fi

cd "${CWD}"
