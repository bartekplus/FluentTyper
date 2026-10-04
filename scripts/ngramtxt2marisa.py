#!/usr/bin/env python3

# Create MARISA-based database for n-grams
#
# Requires: marisa-trie

import argparse
import array
import os, sys
import marisa_trie

parser = argparse.ArgumentParser(
    description="""
This script generates N-gram database suitable for MARISA-based
Presage predictor. The database is stored in dedicated folder
and consists of MARISA Trie file with n-gram words and separate
file with n-gram counts.

The database is generated from n-gram text file consisting of lines
in the following format:
NGRAM word word ... word\tCOUNT

where NGRAM is 1 (for word frequencies), 2 or more, words of the n-gram are separated by
space from NGRAM and between each other, and COUNT is the number of times it occured in
the corpus. Note that COUNT is separated from the last word by TAB
"""
)

parser.add_argument("--inputfile", type=str, required=True, help="n-gram text file")

parser.add_argument(
    "--output",
    type=str,
    required=True,
    help="Name of the new directory where n-gram database in MARISA format will be written. This directory will be created by the script",
)

parser.add_argument(
    "--overwrite", action="store_true", help="Overwrite existing MARISA database"
)


args = parser.parse_args()

if os.path.exists(args.output):
    if args.overwrite:
        print("\nGoing to overwrite existing MARISA trie database\n")
    else:
        print("Cannot write MARISA database into existing directory %s" % args.output)
        print("Please provide path for directory that will be created by this script")
        sys.exit(-1)

else:
    os.makedirs(args.output)

# open the data file
print("Loading n-grams")
data = {}
ranges = {}
keyset = []
with open(args.inputfile, encoding="utf-8") as f:
    for line in f:
        line = line.rstrip()
        key, count = line.split("\t")
        count = int(count)
        data[key] = data.get(key, 0) + count
        keyset.append(key)
        n = key.split()[0]
        mn, mx = ranges.get(n, (count, count))
        ranges[n] = (min(mn, count), max(mx, count))


for k in sorted(ranges):
    print("Range of counts for " + k + "-gram: ", ranges[k][0], ranges[k][1])

# get sum
print("Calculating sum of word counts")
scount = 0
for k, v in data.items():
    if k[:2] == "1 ":
        scount += v
if scount == 0:
    scount = 1  # setting 1 as minimum

print("\nSum of 1-gram:", scount)

if scount > 2**31:
    print(
        "Trouble: sum of 1-grams doesn't fit INT32. Please normalize the data manually"
    )
    sys.exit(-1)

# save ngrams
print("Saving in Marisa format")
trie = marisa_trie.Trie(keyset)
trie.save(os.path.join(args.output, "ngrams.trie"))

print("Keys: ", len(trie), "\n")

arr = array.array("i", [0]) * (len(trie) + 1)
arr[0] = scount
for k, v in data.items():
    arr[trie.key_id(k) + 1] = v

with open(os.path.join(args.output, "ngrams.counts"), "wb") as f:
    arr.tofile(f)
