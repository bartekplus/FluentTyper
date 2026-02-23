#!/usr/bin/env python3

from __future__ import annotations

import argparse
import os
import re
import shlex
import shutil
import subprocess
import sys
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parent
BUILD_DIR = (SCRIPT_DIR / ".deps").resolve()
PROJECT_ROOT = (SCRIPT_DIR / "..").resolve()
PUBLIC_LIBPRESAGE_DIR = (PROJECT_ROOT / "public" / "third_party" / "libpresage").resolve()
SRC_LIBPRESAGE_DIR = (PROJECT_ROOT / "src" / "third_party" / "libpresage").resolve()
EM_CACHE_DIR = (BUILD_DIR / "emscripten_cache").resolve()


def cpu_jobs() -> int:
    return max(1, os.cpu_count() or 1)


def chronic_prefix() -> list[str]:
    return ["chronic"] if shutil.which("chronic") else []


def run_cmd(
    cmd: list[str],
    cwd: Path | None = None,
    env: dict[str, str] | None = None,
    quiet: bool = False,
) -> None:
    full_cmd = [*chronic_prefix(), *cmd] if quiet else cmd
    print(f"$ {shlex.join(full_cmd)}")
    subprocess.run(full_cmd, check=True, cwd=str(cwd) if cwd else None, env=env)


def clone_if_missing(repo_url: str, target_dir: Path, extra_args: list[str] | None = None) -> None:
    if target_dir.is_dir():
        return
    args = ["git", "clone"]
    if extra_args:
        args.extend(extra_args)
    args.append(repo_url)
    run_cmd(args, cwd=BUILD_DIR, quiet=True)


def ensure_hunspell(env: dict[str, str], jobs: int) -> None:
    print("Building HUNSPELL")
    target = BUILD_DIR / "hunspell"
    clone_if_missing("git@github.com:hunspell/hunspell.git", target, ["--depth", "1", "--branch", "v1.7.2"])

    if not (target / "Makefile").is_file():
        run_cmd(["emconfigure", "autoreconf", "-vfi"], cwd=target, env=env, quiet=True)
        run_cmd(
            ["emconfigure", "./configure", "--enable-static=yes", "--enable-shared=no", "--host=i686-gnu"],
            cwd=target,
            env=env,
            quiet=True,
        )

    run_cmd(["emmake", "make", f"-j{jobs}"], cwd=target, env=env, quiet=True)

    libs_dir = target / "src" / "hunspell" / ".libs"
    for pattern in ("libhunspell.*",):
        for path in libs_dir.glob(pattern):
            path.unlink(missing_ok=True)

    shutil.copy2(libs_dir / "libhunspell-1.7.a", libs_dir / "libhunspell.a")
    shutil.copy2(libs_dir / "libhunspell-1.7.la", libs_dir / "libhunspell.la")
    shutil.copy2(libs_dir / "libhunspell-1.7.lai", libs_dir / "libhunspell.lai")
    print("HUNSPELL built")


def ensure_aspell(env: dict[str, str], jobs: int) -> None:
    print("Building ASPELL")
    target = BUILD_DIR / "aspell"
    clone_if_missing("git@github.com:GNUAspell/aspell.git", target, ["--depth", "1"])

    if not (target / "Makefile").is_file():
        run_cmd(["emconfigure", "./autogen"], cwd=target, env=env, quiet=True)
        run_cmd(
            ["emconfigure", "./configure", "--enable-static=yes", "--enable-shared=no", "--host=i686-gnu"],
            cwd=target,
            env=env,
            quiet=True,
        )

    run_cmd(["emmake", "make", f"-j{jobs}"], cwd=target, env=env, quiet=True)
    print("ASPELL built")


def ensure_marisa_trie(env: dict[str, str], jobs: int) -> None:
    print("Building MARISA-TRIE")
    target = BUILD_DIR / "marisa-trie"
    clone_if_missing("git@github.com:s-yata/marisa-trie.git", target, ["--depth", "1", "--branch", "v0.2.6"])

    if not (target / "Makefile").is_file():
        run_cmd(["emconfigure", "autoreconf", "-i"], cwd=target, env=env, quiet=True)
        run_cmd(
            ["emconfigure", "./configure", "--disable-shared", "--host=i686-gnu"],
            cwd=target,
            env=env,
            quiet=True,
        )

    run_cmd(["emmake", "make", f"-j{jobs}"], cwd=target, env=env, quiet=True)
    print("MARISA-TRIE built")


def ensure_presage(env: dict[str, str], jobs: int) -> None:
    print("=== Building PRESAGE ===")
    target = BUILD_DIR / "presage"
    clone_if_missing("git@github.com:bartekplus/presage.git", target, ["--depth", "1"])

    if not (target / "Makefile").is_file():
        run_cmd(["emconfigure", "autoreconf", "-i", "-f"], cwd=target, env=env, quiet=True)
        run_cmd(["emconfigure", "./bootstrap"], cwd=target, env=env, quiet=True)
        run_cmd(
            [
                "emconfigure",
                "./configure",
                "--host=i686-gnu",
                "--disable-python-binding",
                "--disable-gprompter",
                "--disable-gpresagemate",
                "--disable-sqlite",
                "--enable-shared",
            ],
            cwd=target,
            env=env,
            quiet=True,
        )

    run_cmd(["emmake", "make", "-C", "src/lib", f"-j{jobs}"], cwd=target, env=env, quiet=True)
    print("PRESAGE built")


def parse_emcc_version() -> str:
    output = subprocess.run(["emcc", "-v"], capture_output=True, text=True, check=True).stderr
    match = re.search(r"(\d+\.\d+\.\d+)", output)
    if not match:
        raise RuntimeError("Unable to detect Emscripten version from `emcc -v`")
    return match.group(1)


def find_file_packager() -> Path:
    emcc_path = shutil.which("emcc")
    if not emcc_path:
        raise RuntimeError("`emcc` not found in PATH")

    emcc_dir = Path(emcc_path).resolve().parent
    candidate = emcc_dir / "tools" / "file_packager.py"
    if candidate.is_file():
        return candidate

    version = parse_emcc_version()
    fallback = Path(f"/opt/homebrew/Cellar/emscripten/{version}/libexec/tools/file_packager.py")
    if fallback.is_file():
        return fallback

    raise RuntimeError("Unable to locate file_packager.py")


def package_resource_dir(file_packager: Path, resource_dir: Path, gen_dir: Path) -> Path:
    dir_name = resource_dir.name
    data_file = gen_dir / f"{dir_name}.data"
    js_file = gen_dir / f"{dir_name}.js"
    preload_arg = f"{resource_dir}@/resources_js/{dir_name}"

    run_cmd(
        [
            sys.executable,
            str(file_packager),
            str(data_file.name),
            "--preload",
            preload_arg,
            f"--js-output={js_file.name}",
        ],
        cwd=gen_dir,
    )

    content = js_file.read_text(encoding="utf-8")
    old_fetch = "fetch(packageName)"
    new_fetch = 'fetch(chrome.runtime.getURL("third_party/libpresage/" + packageName))'
    if old_fetch in content:
        content = content.replace(old_fetch, new_fetch)
        js_file.write_text(content, encoding="utf-8")
    else:
        print(f"Warning: Could not find strict fetch(packageName) in {js_file}")

    PUBLIC_LIBPRESAGE_DIR.mkdir(parents=True, exist_ok=True)
    shutil.copy2(data_file, PUBLIC_LIBPRESAGE_DIR / data_file.name)
    return js_file


def link_library(debug: bool, pre_js_files: list[Path], gen_dir: Path) -> None:
    print("=== Linking ===")

    marisa_lib = BUILD_DIR / "marisa-trie" / "lib" / "marisa" / ".libs"
    hunspell_lib = BUILD_DIR / "hunspell" / "src" / "hunspell" / ".libs"
    aspell_lib = BUILD_DIR / "aspell" / ".libs"
    presage_so = BUILD_DIR / "presage" / "src" / "lib" / ".libs" / "libpresage.so.1.1.1"

    compile_options = ["-O0", "-sASSERTIONS", "-sNO_DISABLE_EXCEPTION_CATCHING"] if debug else ["-O3", "-s", "NO_EXIT_RUNTIME=1"]

    cmd = [
        "emcc",
        str(presage_so),
        "-o",
        "libpresage.js",
        "-s",
        "ALLOW_MEMORY_GROWTH=1",
        "--bind",
        "-L" + str(marisa_lib),
        "-L" + str(hunspell_lib),
        "-L" + str(aspell_lib),
        *compile_options,
        "-lhunspell",
        "-laspell",
        "-lmarisa",
        "-s",
        "EXPORTED_RUNTIME_METHODS=['FS']",
        "-s",
        "MODULARIZE=1",
        "-s",
        "ENVIRONMENT=web",
        "-s",
        "TEXTDECODER=1",
        "-s",
        "EXPORT_ES6=1",
        "--llvm-lto",
        "1",
        "-sFORCE_FILESYSTEM",
        "-s",
        "NO_DYNAMIC_EXECUTION=1",
        "-sSTACK_SIZE=5MB",
    ]

    for pre_js in pre_js_files:
        cmd.extend(["--pre-js", pre_js.name])

    run_cmd(cmd, cwd=gen_dir)
    SRC_LIBPRESAGE_DIR.mkdir(parents=True, exist_ok=True)
    shutil.copy2(gen_dir / "libpresage.js", SRC_LIBPRESAGE_DIR / "libpresage.js")
    shutil.copy2(gen_dir / "libpresage.wasm", SRC_LIBPRESAGE_DIR / "libpresage.wasm")


def main() -> int:
    parser = argparse.ArgumentParser(description="Build libpresage and package resources.")
    parser.add_argument("-d", "--debug", action="store_true", help="Enable debug mode")
    parser.add_argument("--deps", action="store_true", help="Build dependencies")
    parser.add_argument("--presage", action="store_true", help="Build Presage library")
    parser.add_argument("--package", action="store_true", help="Package data files")
    parser.add_argument("--link", action="store_true", help="Link output library")
    parser.add_argument("--all", action="store_true", help="Run all stages")
    args = parser.parse_args()

    build_deps = args.deps
    build_presage = args.presage
    package_data = args.package
    link_lib = args.link

    if args.all or not any((build_deps, build_presage, package_data, link_lib)):
        build_deps = build_presage = package_data = link_lib = True

    BUILD_DIR.mkdir(parents=True, exist_ok=True)
    EM_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    os.environ["EM_CACHE"] = str(EM_CACHE_DIR)
    jobs = cpu_jobs()

    base_env = os.environ.copy()
    base_env["CFLAGS"] = "-O3"
    base_env["CXXFLAGS"] = "-O3"
    base_env["LIBTOOLIZE"] = "glibtoolize"
    base_env["EM_CACHE"] = str(EM_CACHE_DIR)

    if build_deps:
        print("=== Building Dependencies ===")
        ensure_hunspell(base_env, jobs)
        ensure_aspell(base_env, jobs)
        ensure_marisa_trie(base_env, jobs)

    if build_presage:
        presage_env = base_env.copy()
        presage_env["CXXFLAGS"] = "-O2 -std=c++17"
        presage_env["CPPFLAGS"] = (
            f"-I{BUILD_DIR / 'marisa-trie' / 'include'} "
            f"-I{BUILD_DIR / 'hunspell' / 'src'} "
            f"-I{BUILD_DIR / 'aspell' / 'interfaces' / 'cc'}"
        )
        presage_env["LDFLAGS"] = (
            "--bind "
            f"-L{BUILD_DIR / 'marisa-trie' / 'lib' / 'marisa' / '.libs'} "
            f"-L{BUILD_DIR / 'hunspell' / 'src' / 'hunspell' / '.libs'} "
            f"-L{BUILD_DIR / 'aspell' / '.libs'}"
        )
        ensure_presage(presage_env, jobs)

    gen_dir = (BUILD_DIR / "gen").resolve()
    gen_dir.mkdir(parents=True, exist_ok=True)

    pre_js_files: list[Path] = []
    if package_data or link_lib:
        file_packager = find_file_packager()
        resource_dirs = sorted(path for path in (PROJECT_ROOT / "resources_js").iterdir() if path.is_dir())
        for resource_dir in resource_dirs:
            if package_data:
                print(f"Packaging data for {resource_dir.name}")
                pre_js_files.append(package_resource_dir(file_packager, resource_dir, gen_dir))
            else:
                pre_js_files.append(gen_dir / f"{resource_dir.name}.js")

    if link_lib:
        link_library(debug=args.debug, pre_js_files=pre_js_files, gen_dir=gen_dir)

    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except subprocess.CalledProcessError as exc:
        print(f"Command failed with exit code {exc.returncode}: {shlex.join(exc.cmd)}")
        raise SystemExit(exc.returncode)
    except RuntimeError as exc:
        print(exc)
        raise SystemExit(1)
