import argparse


import os
from codecs import encode, decode
from nltk import sent_tokenize, FreqDist
from nltk.util import ngrams
from nltk.tokenize import TweetTokenizer
from collections import Counter
import re


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


def replace_character_in_middle(text, character_to_replace, replacement_character):
    # Create a regular expression pattern to match the character in the middle of words
    pattern = r"\b(\w+)" + re.escape(character_to_replace) + r"(\w+)\b"

    # Define the replacement pattern
    replacement_pattern = r"\1" + replacement_character + r"\2"

    # Use re.sub() to perform the replacement
    replaced_text = re.sub(pattern, replacement_pattern, text)

    return replaced_text


def fix_common_errors(line):
    line = replace_character_in_middle(line, "’", "'")
    return line


def filter_tokens(tokens_raw):
    tokens = []
    for token in tokens_raw:
        SKIPPED_CHARS = '!"#$%&()*+,./:;<=>?@[\\]^_`{|}~'

        token = token.strip()

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
        tokens.append(token.lower())
    return tokens


if __name__ == "__main__":
    args = parser.parse_args()

    tk = TweetTokenizer()
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
                n = ngrams(tokens_raw, c + 1)
                ngram[c].update(n)

        if counter % 100000 == 0:
            print(f"Processed {counter} lines")

        counter += 1

    last_ngram_count = 0
    filenames = []
    for c in range(NGRAM_COUNT):
        # fdist = FreqDist(ngram[c - 1])
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
