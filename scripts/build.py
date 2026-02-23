#!/usr/bin/env python3

import runpy
from pathlib import Path


if __name__ == "__main__":
    runpy.run_path(str(Path(__file__).with_name("rebuild_all.py")), run_name="__main__")
