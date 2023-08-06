#!/usr/bin/env bash

set -eu

CWD=$(pwd)
SCRIPT_DIR=$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )
BUILD_DIR="${SCRIPT_DIR}/.deps"
source "${SCRIPT_DIR}/langs.sh"
export CXXFLAGS="-O2"
export CFLAGS="-O2"

mkdir -p ${BUILD_DIR}
# Build deps

# HUNSPELL
echo "Building HUNSPELL"
BUILD_DIR_HUNSPELL="${BUILD_DIR}/hunspell"
export LIBTOOLIZE=glibtoolize

if [ ! -d ${BUILD_DIR_HUNSPELL} ]; then
    cd ${BUILD_DIR}
    chronic git clone --depth 1 --branch v1.7.2 git@github.com:hunspell/hunspell.git
    cd ${BUILD_DIR_HUNSPELL}
    chronic emconfigure autoreconf -vfi
    chronic emconfigure ./configure --enable-static=yes  --enable-shared=no --host=i686-gnu 
fi

cd ${BUILD_DIR_HUNSPELL}
chronic emmake make -j

# Workaround lib name issue
rm -rf ${BUILD_DIR_HUNSPELL}/src/hunspell/.libs/libhunspell.*
cp ${BUILD_DIR_HUNSPELL}/src/hunspell/.libs/libhunspell-1.7.a ${BUILD_DIR_HUNSPELL}/src/hunspell/.libs/libhunspell.a
cp ${BUILD_DIR_HUNSPELL}/src/hunspell/.libs/libhunspell-1.7.la ${BUILD_DIR_HUNSPELL}/src/hunspell/.libs/libhunspell.la
cp ${BUILD_DIR_HUNSPELL}/src/hunspell/.libs/libhunspell-1.7.lai ${BUILD_DIR_HUNSPELL}/src/hunspell/.libs/libhunspell.lai

echo "HUNSPELL built"

# ASPELL
echo "Building ASPELL"
BUILD_DIR_ASPELL="${BUILD_DIR}/aspell"

if [ ! -d ${BUILD_DIR_ASPELL} ]; then
    cd ${BUILD_DIR}
    chronic git clone --depth 1 --branch rel-0.60.8 git@github.com:GNUAspell/aspell.git
    cd ${BUILD_DIR_ASPELL}
    chronic emconfigure ./autogen
    chronic emconfigure ./configure --enable-static=yes  --enable-shared=no --host=i686-gnu 
fi

cd ${BUILD_DIR_ASPELL}
chronic emmake make -j
echo "ASPELL built"

# MARISA-TRIE
echo "Building MARISA-TRIE"
BUILD_DIR_MARISA_TRIE="${BUILD_DIR}/marisa-trie"

if [ ! -d ${BUILD_DIR_MARISA_TRIE} ]; then
    cd ${BUILD_DIR}
    chronic git clone --depth 1 --branch v0.2.6 git@github.com:s-yata/marisa-trie.git
    cd ${BUILD_DIR_MARISA_TRIE}
    chronic emconfigure autoreconf -i
    chronic emconfigure ./configure  --disable-shared --host=i686-gnu 
fi

cd ${BUILD_DIR_MARISA_TRIE}
chronic emmake make -j
echo "MARISA-TRIE built"


# PRESAGE
echo "Building PRESAGE"
BUILD_DIR_PRESAGE="${BUILD_DIR}/presage"
export CXXFLAGS="-O2 -std=c++14"
export CPPFLAGS="-I${BUILD_DIR_MARISA_TRIE}/include -I${BUILD_DIR_HUNSPELL}/src -I${BUILD_DIR_ASPELL}/interfaces/cc/"
export LDFLAGS="--bind -L${BUILD_DIR_MARISA_TRIE}/lib/marisa/.libs -L${BUILD_DIR_HUNSPELL}/src/hunspell/.libs -L${BUILD_DIR_ASPELL}/.libs"

if [ ! -d ${BUILD_DIR_PRESAGE} ]; then
    cd ${BUILD_DIR}
    chronic git clone --depth 1 git@github.com:bartekplus/presage.git 2> /dev/null
    cd ${BUILD_DIR_PRESAGE}
    chronic emconfigure autoreconf -i -f
    chronic emconfigure ./bootstrap
    chronic emconfigure ./configure --host=i686-gnu  --disable-python-binding --disable-gprompter --disable-gpresagemate --disable-sqlite --enable-shared
fi

cd ${BUILD_DIR_PRESAGE}
chronic emmake make -j || true
echo "PRESAGE built"

BUILD_CMD=""
for lang in "${LANGS[@]}"
do
    python3 /opt/homebrew/Cellar/emscripten/3.1.44/libexec/tools/file_packager.py ${lang}.data --preload ${SCRIPT_DIR}/../resources_js/${lang}@/resources_js/${lang} --js-output=${lang}.js
    BUILD_CMD="${BUILD_CMD} --pre-js ${lang}.js"
    cp ${lang}.data ${SCRIPT_DIR}/../src/third_party/libpresage/
done

#python3 /opt/homebrew/Cellar/emscripten/3.1.44/libexec/tools/file_packager.py es.data --preload ${SCRIPT_DIR}/../resources_js/es/ --js-output=es.js
#python3 /opt/homebrew/Cellar/emscripten/3.1.44/libexec/tools/file_packager.py fr.data --preload ${SCRIPT_DIR}/../resources_js/fr/ --js-output=fr.js
#python3 /opt/homebrew/Cellar/emscripten/3.1.44/libexec/tools/file_packager.py hr.data --preload ${SCRIPT_DIR}/../resources_js/hr/ --js-output=hr.js
#python3 /opt/homebrew/Cellar/emscripten/3.1.44/libexec/tools/file_packager.py el.data --preload ${SCRIPT_DIR}/../resources_js/el/ --js-output=el.js
#python3 /opt/homebrew/Cellar/emscripten/3.1.44/libexec/tools/file_packager.py sv.data --preload ${SCRIPT_DIR}/../resources_js/sv/ --js-output=sv.js

python3 /opt/homebrew/Cellar/emscripten/3.1.44/libexec/tools/file_packager.py textExpander.data --preload ${SCRIPT_DIR}/../resources_js/textExpander@/resources_js/textExpander --js-output=textExpander.js
python3 /opt/homebrew/Cellar/emscripten/3.1.44/libexec/tools/file_packager.py common.data --preload ${SCRIPT_DIR}/../resources_js/common@/resources_js/common --js-output=common.js

emcc ${BUILD_DIR_PRESAGE}/src/lib/.libs/libpresage.so.1.1.1 -o libpresage.js -s ALLOW_MEMORY_GROWTH=1 -O2 \
    ${LDFLAGS} \
    -lhunspell -laspell -lmarisa \
    -s "EXPORTED_RUNTIME_METHODS=['FS']" -s MODULARIZE=1 -s ENVIRONMENT=web -s TEXTDECODER=1 -s EXPORT_ES6=1 -s NO_EXIT_RUNTIME=1 \
    --llvm-lto 1 -sFORCE_FILESYSTEM  -s NO_DYNAMIC_EXECUTION=1 \
    ${BUILD_CMD} --pre-js common.js --pre-js textExpander.js \
    -sSTACK_SIZE=5MB

cp libpresage.* ${SCRIPT_DIR}/../src/third_party/libpresage/



cd ${CWD}