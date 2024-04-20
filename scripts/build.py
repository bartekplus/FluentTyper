#!/usr/bin/env python3

from collections import namedtuple
import argparse
import os
from string import Template
import distutils
import langcodes

Language = namedtuple(
    typename="Language", field_names=["language", "aspell_url", "aspell_language"], defaults=(None,)
)

LANG_ARR = [
   Language(
        langcodes.Language.get('de-DE'),
        "https://rpmfind.net/linux/opensuse/ports/i586/tumbleweed/repo/oss/i586/aspell-de-20161207.7.0-4.1.i586.rpm",
        "de"
    ),
    Language(
        langcodes.Language.get('el-GR'),
        "https://rpmfind.net/linux/opensuse/ports/i586/tumbleweed/repo/oss/i586/aspell-el-0.50.3+0.08-4.1.i586.rpm",
        "el"
    ),
    Language(
        langcodes.Language.get('en-US'),
        "https://rpmfind.net/linux/opensuse/ports/i586/tumbleweed/repo/oss/i586/aspell-en-2020.12.07-2.5.i586.rpm",
    ),
    Language(
        langcodes.Language.get('es-ES'),
        "https://rpmfind.net/linux/opensuse/ports/i586/tumbleweed/repo/oss/i586/aspell-es-1.11.2-4.1.i586.rpm",
        "es"
    ),
    Language(
        langcodes.Language.get('fr-FR'),
        "https://rpmfind.net/linux/opensuse/ports/i586/tumbleweed/repo/oss/i586/aspell-fr-0.50.3-4.1.i586.rpm",
    ),
    Language(
        langcodes.Language.get('hr-HR'),
        "https://rpmfind.net/linux/opensuse/ports/i586/tumbleweed/repo/oss/i586/aspell-hr-0.51.0-4.1.i586.rpm",
        "hr"
    ),
    Language(
        langcodes.Language.get('pl-PL'),
        "https://rpmfind.net/linux/opensuse/ports/i586/tumbleweed/repo/oss/i586/aspell-pl-0.60.2015.04.28-4.1.i586.rpm",
        "pl"
    ),
    Language(
        langcodes.Language.get('pt-BR'),
        "https://rpmfind.net/linux/opensuse/ports/i586/tumbleweed/repo/oss/i586/aspell-pt_BR-20131030.12.0-4.1.i586.rpm",
    ),
    Language(
        langcodes.Language.get('sv-SE'),
        "https://rpmfind.net/linux/opensuse/ports/i586/tumbleweed/repo/oss/i586/aspell-sv-0.51.0-4.1.i586.rpm",
        "sv"
    ),
]

LANGS = {str(value.language).replace("-", "_"): value for index, value in enumerate(LANG_ARR)}
SCRIPT_DIR = os.path.abspath(os.path.realpath(os.path.dirname(__file__)))
RESOURCES_DIR = os.path.abspath(os.path.join(SCRIPT_DIR, "..", "resources_js"))
RESOURCES_TEMPLATE_DIR = os.path.abspath(
    os.path.join(SCRIPT_DIR, "..", "resources_js_template")
)
RESOURCES_LANG_TEMPLATE_DIR = os.path.abspath(
    os.path.join(SCRIPT_DIR, "..", "resources_js_lang_template")
)
REBUILD_NGRAM_PATH = os.path.join(SCRIPT_DIR, "rebuild_ngram_db.sh")
REBUILD_LIB_PRESAGEH = os.path.join(SCRIPT_DIR, "rebuild_libpresage.sh")

parser = argparse.ArgumentParser(
    prog="Build", description="Build FluentTyper language database"
)

parser.add_argument(
    "-l",
    "--lang",
    help="Languge to rebuild, or all if ommited",
    required=False,
    choices=LANGS.keys(),
    default=LANGS.keys(),
    nargs="+",
)

parser.add_argument(
    "-d",
    "--debug",
    help="Enable debug mode",
    required=False,
    default=False,
    action="store_true",
)

parser.add_argument(
    "-r",
    "--repack",
    help="Skip language build, repack only",
    required=False,
    default=False,
    action="store_true",
)


def run_cmd(cmd: str):
    print(f"Running cmd: {cmd}")
    assert 0 == os.system(cmd)

def update_template(template_file, lang, debug: bool) -> None:
    replacement = {
        "LANG_VARIANT": lang,
        "LANG_ASPELL": LANGS[lang].aspell_language if LANGS[lang].aspell_language else lang,
        "LOGGER": ("DEBUG" if debug else "ERROR"),
    }

    with open(template_file, "r+") as f:
        src = Template(f.read())
        result = src.substitute(replacement)
        f.seek(0)
        f.write(result)
        f.truncate()


def create_resource_js() -> None:
    # Create resources dir
    os.makedirs(RESOURCES_DIR, exist_ok=True)

    distutils.dir_util.copy_tree(RESOURCES_TEMPLATE_DIR, RESOURCES_DIR)


def create_lang_config_from_template(lang: str, debug: bool) -> None:
    resources_lang_template_dst = os.path.join(RESOURCES_DIR, f"{lang}")
    resources_hunspell_lang_template_dst = os.path.join(
        resources_lang_template_dst, "hunspell"
    )

    os.makedirs(resources_lang_template_dst, exist_ok=True)
    os.makedirs(resources_hunspell_lang_template_dst, exist_ok=True)

    # Copy lang template dir
    distutils.dir_util.copy_tree(
        RESOURCES_LANG_TEMPLATE_DIR, resources_lang_template_dst
    )

    # XML template path
    xml_resources_lang_template_dst = os.path.join(
        resources_lang_template_dst, f"presage.xml"
    )

    # Update template with correct lang
    update_template(xml_resources_lang_template_dst, lang, debug)


def install_aspell_dictionary(lang: str) -> None:
    if LANGS[lang].aspell_url:
        resources_lang_aspell_dir = os.path.join(RESOURCES_DIR, f"{lang}", "aspell")
        build_aspell_dictionary_path = os.path.join(
            SCRIPT_DIR, "build_aspell_dictionary.sh"
        )
        build_aspell_dictionary_cmd = f"{build_aspell_dictionary_path} -u {LANGS[lang].aspell_url} -d {resources_lang_aspell_dir}"
        run_cmd(build_aspell_dictionary_cmd)


def install_hunspell_dictionary(lang: str) -> None:
    resources_lang_hunspell_dir = os.path.join(RESOURCES_DIR, f"{lang}", "hunspell")
    build_hunspell_dictionary_path = os.path.join(
        SCRIPT_DIR, "build_hunspell_dictionary.sh"
    )
    build_hunspell_dictionary_cmd = (
        f"{build_hunspell_dictionary_path} -l {lang} -d {resources_lang_hunspell_dir}"
    )
    run_cmd(build_hunspell_dictionary_cmd)


if __name__ == "__main__":
    args = parser.parse_args()

    if not args.repack:
        create_resource_js()

        for lang in args.lang:
            create_lang_config_from_template(lang, args.debug)
            install_aspell_dictionary(lang)
            install_hunspell_dictionary(lang)

            rebuild_ngram_cmd = (
                f"{REBUILD_NGRAM_PATH} -l {LANGS[lang].language.language} -v {lang}"
            )
            run_cmd(rebuild_ngram_cmd)
    rebuild_lib_preseage_cmd = f"{REBUILD_LIB_PRESAGEH}" + (" -d" if args.debug else "")
    run_cmd(rebuild_lib_preseage_cmd)
