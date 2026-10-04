import { expect, test } from "bun:test";
import { chunkTimesWithoutJit, slowestChunkMs } from "./reviewHarness";

// Worst cases for the lexicon slot frames in review/english/*Slots.ts: every word starts a
// frame and the token reader looks ahead from each one.
const SLOT_WORDS =
  "its your it you to too two the a an this these those many much each every other have has " +
  "had be is was were do does did can could would should there here people not no I he she we " +
  "who that me myself and ";

test("no chunk stalls on runs of slot-opening words or spaces between them", () => {
  const inputs = [
    SLOT_WORDS.repeat(160),
    SLOT_WORDS.split(" ").join(" ".repeat(60)).repeat(8),
    "its very very very ".repeat(1_500),
    "the the the the ".repeat(1_500),
    "There a lot of ".repeat(1_000),
    "could possible ".repeat(2_000),
    "people thinks ".repeat(2_000),
    ". The tall guys who met him yesterday really ".repeat(500),
    "Tim and me and Sam and me went ".repeat(600),
    "better a b c d e then ".repeat(800),
    "an ever by then were where ".repeat(700),
    "there is many a few there are no ".repeat(700),
    "didn't see not never no nothing nobody ".repeat(700),
    "a very good nice fine advice less much people ".repeat(600),
    "the tools that runs which is who make ".repeat(700),
    "The kids in my class, for example, who that the one that he uses run ".repeat(500),
    "Who send it and it it it will user would can could Phones such as these ".repeat(500),
    "When go you I no like we work here since 2010 most of it efforts, the the ".repeat(500),
    "there are a there exist it not possible this not the script it not nothing it ".repeat(500),
    "Because when if so that I look forward your looking forward in ".repeat(600),
    "how did he does it is an oldest less then more ".repeat(600),
    "I have plan the we have see all the ".repeat(700),
    "tomorrow we visited the the yesterday we will call him on 27/10/2090 we visited ".repeat(500),
    "there is not time I have not issues would no do am no going to easy achieve ".repeat(500),
    "afraid from married with a in Monday a lot people between 1 to listen the went to home ".repeat(
      500,
    ),
    "hear form at there old though he That sound great All car are Please sent the I no good ".repeat(
      500,
    ),
    "According to priorities the wold for there ".repeat(900),
    "drove to fast there is not a 2 its the will should by this it he going someone else ".repeat(
      300,
    ),
    "the my symptom's are it you have help us helps nobody told me nothing in this at the at the this kind of ".repeat(
      300,
    ),
    "suffering of anxious of accused him for participate to near from came in the arrived on non the ".repeat(
      300,
    ),
    "of cause rally tent to sounds god pleas it sees would me Her you cheep asses well tor have to shout ".repeat(
      300,
    ),
    "cab sen posses wen yo as been coma turn of shell loose lose chance except buy whet hwy art as for ".repeat(
      300,
    ),
    "know id I an not Whose the Hell be Th as gotten a vary sill too 3 Ur mus look the How is ".repeat(
      400,
    ),
    "cold be ca I is no one the Them it think is should opening seen fully complaint withe ".repeat(
      400,
    ),
    "There're problem are know being several other a must see The are I maybe an a this types of ".repeat(
      400,
    ),
    "keep see going be made me thinking Was there many though the farther advise would we us ".repeat(
      400,
    ),
    "got it did Kind regard everyone of anyway to sometime anymore went good more person Do anyone ".repeat(
      400,
    ),
  ];
  // Warm-up: the first scan of a frame compiles it. That one-time cost is not a stall. The
  // start of each input holds all its words, so it compiles the same frames.
  for (const text of inputs) slowestChunkMs(text.slice(0, 5_000));
  for (const text of inputs) expect(slowestChunkMs(text)).toBeLessThan(100);
  // The per-chunk bound is the assertion. The total run time depends on the runner.
}, 30_000);

// JavaScriptCore may run a regex in its interpreter (late in the full unit suite it does): a
// lookbehind with an unbounded run of spaces then rereads the run at every position. A child
// process without the regex JIT makes that cost visible for the slot and clause frames. A space
// run is one chunk, so the interpreter's time grows with it: doubling the run must about double
// the time (a quadratic frame quadruples it).
test("slot frames stay linear on long space runs without the regex JIT", () => {
  const words =
    " didn't see nothing. a very good advice. less people. tools that runs. " +
    "how did he went. is best choice. I have plan the trip. If I would not have known. Do it. " +
    "afraid from the dark. see you in Monday. a lot people. went to home. stopped him of going. " +
    "Tomorrow we visited them. We will call him yesterday. We visited the client on 27/10/2090. " +
    "The lamp that he repairs flicker. My sister, for example, live there. ";
  const rules = [
    "englishCountability",
    "englishUsagePhrases",
    "englishSubjectVerbAgreement",
    "englishAuxiliaryBaseVerb",
    "englishSentenceStructure",
    "englishDoubledDegree",
    "englishThenThan",
    "englishPerfectParticiples",
    "englishConfusedWords",
    "englishVerbComplements",
    "englishFixedPrepositions",
    "englishTenseConsistency",
  ];
  const text = (n: number) => "x." + "\t ".repeat(n) + words + " \n".repeat(n) + words;
  const [long, short] = chunkTimesWithoutJit([
    ["en_US", text(3000), rules],
    ["en_US", text(1500), rules],
  ]);
  expect(long / short).toBeLessThan(3);
});
