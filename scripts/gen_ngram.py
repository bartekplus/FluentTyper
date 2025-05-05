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
import multiprocessing
import itertools
import functools


NGRAM_COUNT = 4
NGRAM_DIV = 1.33
NGRAM_MIN_COUNT = 10
LANGS = {
    "de": "german",
    "el": "greek",
    "en": "english",
    "es": "spanish",
    "fr": "french",
    "hr": "croatian",
    "pl": "polish",
    "pt": "portuguese",
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
    tokens_array = []
    tokens = []
    for token in tokens_raw:
        SKIPPED_CHARS = '!"#$%&()*+,./:;<=>?@[\\]^_`{|}~'
        split = False
        token_orig = token.strip()
        token = token.strip().lower()

        if not token:
            split = True
        elif not token.isprintable():
            split = True
        elif len(token) <= 1 and not token.isalpha():
            split = True
        elif token.isdigit():
            split = True
        elif any([x in token for x in SKIPPED_CHARS]):
            split = True
        elif not token[0].isalpha():
            split = True
        elif len(token) > 1 and token_orig == token_orig.upper():
            split = True

        if split:
            tokens_array.append(tokens)
            tokens = []
        else:
            tokens.append(token)

    tokens_array.append(tokens)
    return tokens_array


def process_chunk(language, chunk):
    """Processes a chunk of lines to count n-grams."""
    local_ngram_counters = [Counter() for _ in range(NGRAM_COUNT)]
    tk = TweetTokenizer(match_phone_numbers=False)  # Initialize tokenizer per process
    lines_processed_in_chunk = 0

    for line in chunk:
        try:
            line = decode(encode(line, "latin-1", "backslashreplace"), "unicode-escape")
        except Exception as e:
            # print(f"Error decoding line, skipping: {e}") # Optional: log errors
            continue

        lines_processed_in_chunk += 1  # Count successfully decoded lines
        # Assuming LANGS is accessible globally or passed if needed
        for sentence in sent_tokenize(line, language=LANGS[language]):
            sentence = fix_common_errors(sentence)
            tokens_raw = tk.tokenize(sentence)
            tokens_array = filter_tokens(tokens_raw)

            for tokens in tokens_array:
                if not tokens:
                    continue
                for c in range(NGRAM_COUNT):
                    # Generate n-grams for the current level
                    n = ngrams(tokens, c + 1)
                    local_ngram_counters[c].update(n)

    return local_ngram_counters, lines_processed_in_chunk


if __name__ == "__main__":
    args = parser.parse_args()

    # download tokenizer data
    nltk.download("punkt")
    nltk.download("punkt_tab")
    # Determine number of processes
    num_processes = multiprocessing.cpu_count()
    print(f"Using {num_processes} processes for parallel processing.")
    # Define chunk size
    chunk_size = 100000  # Adjust as needed based on memory/performanc
    # Initialize global counters
    final_ngram_counters = [Counter() for _ in range(NGRAM_COUNT)]
    base_path = os.path.splitext(args.inputfile.name)[0]
    total_lines_processed = 0
    print("Starting n-gram processing...")
    with multiprocessing.Pool(processes=num_processes) as pool:
        # Read file in chunks and map to workers
        line_iterator = iter(args.inputfile)

        def chunk_generator():
            while True:
                chunk = list(itertools.islice(line_iterator, chunk_size))
                if not chunk:
                    return  # Stop iteration when file ends
                yield chunk

        # Create a partial function with the language argument fixed.
        # Only the chunk will be passed in each call by imap_unordered.
        partial_process_chunk = functools.partial(process_chunk, args.language)

        # Process chunks in parallel using imap_unordered
        for result_counters, lines_in_chunk in pool.imap_unordered(
            partial_process_chunk, chunk_generator()
        ):
            # Merge results from the completed chunk processing
            for i in range(NGRAM_COUNT):
                final_ngram_counters[i].update(result_counters[i])
            total_lines_processed += lines_in_chunk
            print(f"Processed {total_lines_processed} lines...")

    print(f"Finished processing. Total lines: {total_lines_processed}")
    args.inputfile.close()  # Close the input file

    last_ngram_count = 0
    filenames = []
    for c in range(NGRAM_COUNT):
        f_name = f"{base_path}_ngram_{c+1}.txt"
        print(f"Generating {f_name}")

        filenames.append(f_name)
        f_ngram = open(f_name, "w")

        ngram_count = 0
        for k, v in final_ngram_counters[c].most_common(
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
