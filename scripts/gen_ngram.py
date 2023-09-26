#!/usr/bin/env python3

import argparse
import os
from codecs import encode, decode
from nltk import sent_tokenize
from nltk.util import ngrams
from nltk.tokenize import TweetTokenizer
from collections import Counter
import re
import nltk

NGRAM_COUNT = 4
NGRAM_DIV = 1.33
NGRAM_MIN_COUNT = 10
LANGS = {
    "el": "greek",
    "en": "english",
    "es": "spanish",
    "fr": "french",
    "hr": "croatian",
    "sv": "swedish",
}

parser = argparse.ArgumentParser()
parser.add_argument(
    "-i",
    "--inputfile",
    help="sentences text file",
    required=True,
    type=argparse.FileType("r", encoding="UTF-8", errors="ignore"),
)
parser.add_argument(
    "-l", "--language", type=str, help="language of the sentences", required=True
)

_replacements = {r"’": "'"}

_replacements_dict = list((re.compile(p), r) for p, r in _replacements.items())


def fix_common_errors(line):
    for pattern_re, replaced_str in _replacements_dict:
        line = pattern_re.sub(replaced_str, line)
    return line


def filter_tokens(tokens_raw):
    tokens = []
    for token in tokens_raw:
        SKIPPED_CHARS = '!"#$%&()*+,./:;<=>?@[\\]^_`{|}~'

        token = token.strip().lower()

        if not token:
            continue
        elif not token.isprintable():
            continue
        elif len(token) == 1 and not token.isalpha():
            continue
        elif token.isdigit():
            continue
        if any([x in token for x in SKIPPED_CHARS]):
            continue
        elif not token[0].isalpha():
            continue

        tokens.append(token)
    return tokens


if __name__ == "__main__":
    args = parser.parse_args()

    # download tokenizer data
    nltk.download("punkt")
    tk = TweetTokenizer(match_phone_numbers=False)
    counter = 1
    ngram = [Counter() for i in range(NGRAM_COUNT)]
    base_path = os.path.splitext(args.inputfile.name)[0]

    for line in args.inputfile:
        try:
            line = decode(encode(line, "latin-1", "backslashreplace"), "unicode-escape")
        except Exception as e:
            print(e)
            continue
        for sentence in sent_tokenize(line, language=LANGS[args.language]):
            sentence = fix_common_errors(sentence)
            tokens_raw = tk.tokenize(sentence)
            tokens_raw = filter_tokens(tokens_raw)

            for c in range(NGRAM_COUNT):
                tokens = tokens_raw
                if c + 1 == 0:
                    tokens = [t for t in tokens_raw if len(t) > 1]
                n = ngrams(tokens_raw, c + 1)
                ngram[c].update(n)

        if counter % 100000 == 0:
            print(f"Processed {counter} lines")

        counter += 1

    last_ngram_count = 0
    filenames = []
    for c in range(NGRAM_COUNT):
        f_name = f"{base_path}_ngram_{c+1}.txt"
        print(f"Generating {f_name}")

        filenames.append(f_name)
        f_ngram = open(f_name, "w")

        ngram_count = 0
        for k, v in ngram[c].most_common(
            n=round(last_ngram_count // NGRAM_DIV) if last_ngram_count else None
        ):
            if v < NGRAM_MIN_COUNT:
                break
            s = f"{c+1} " + " ".join(k) + f"\t{v}\n"
            f_ngram.write(s)
            ngram_count += 1
        last_ngram_count = ngram_count
        f_ngram.close()

    with open(f"{base_path}_ngram_merged.txt", "w") as outfile:
        for fname in filenames:
            with open(fname) as infile:
                for line in infile:
                    outfile.write(line)
