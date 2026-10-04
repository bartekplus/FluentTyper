import { expect, test } from "bun:test";
import { slowestChunkMs } from "./reviewHarness";

// Worst cases for the English apostrophe, typography and naming frames: every word opens one.
test("no chunk stalls on runs of frame-opening words", () => {
  const inputs = [
    "two lamp's ".repeat(1_500),
    "many old CD's ".repeat(1_200),
    "he see's it ".repeat(1_500),
    "who's car is ".repeat(1_200),
    "other's ideas ".repeat(1_200),
    "last weeks game ".repeat(1_000),
    "I' m they 're ".repeat(1_000),
    "we''ll ".repeat(2_000),
    "most user's would ".repeat(1_000),
    "french polish ".repeat(1_500),
    "the excel file ".repeat(1_200),
    "you tube google ".repeat(1_200),
    "1.250.000,5 7,5% ".repeat(1_000),
    "U.S.A e.g PH.D ".repeat(1_000),
    '4 x 5 -> "a" (c) 1914-1918 '.repeat(600),
    "cold - very ".repeat(1_500),
    "Why do not you with who you ".repeat(800),
    "combined together wanna ".repeat(1_000),
    "was not always generally quickly made up by ".repeat(500),
    "If I can with it I Do you know, if neither a, nor ".repeat(400),
    "June 16,1963 Friday July 15 October, 1958 ".repeat(400),
    "in Big Blue Green Sea is oldest city in lot of ".repeat(400),
    "I all ready the later we can here he barley yet alone ".repeat(400),
    "I was here and we left but they stay so I can or the van is ".repeat(400),
    "and ".repeat(3_000),
    "if you car was for you time did you team check you new coat is ".repeat(250),
    "big in size $5 dollars more than 9+ return it back to ".repeat(300),
    "born in china from turkey the black sea over thanksgiving id like my id is ".repeat(300),
    "we need to login please setup who logins to backup ".repeat(300),
    "this is were the more that an then right know once of all ready jut doe bares ".repeat(250),
    "found anther tanks for lets just is save how to us one if an see this from letter form ".repeat(
      200,
    ),
    "so curios I red past it event do to may ave told is take car the to cam com hart wurst than you ad due quite quiet loss lose here massage peaked man every bet as off ".repeat(
      100,
    ),
  ];
  // Warm-up: the first scan compiles every frame and decodes the lexicon.
  for (const text of inputs) slowestChunkMs(text);
  for (const text of inputs) expect(slowestChunkMs(text)).toBeLessThan(100);
  // The per-chunk bound is the assertion. The total run time depends on the runner.
}, 30_000);
