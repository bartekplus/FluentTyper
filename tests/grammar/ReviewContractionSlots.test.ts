import { expect, test } from "bun:test";
import { applyEdits } from "../../src/core/domain/grammar/review/textRanges";
import { scan as reviewScan } from "./reviewHarness";

const RULES = new Set(["englishItsContext", "englishYourYouAre"]);
function scan(text: string) {
  return reviewScan(text).filter((d) => RULES.has(d.ruleId));
}

const fixes: Array<[string, string]> = [
  ["Its pretty windy out there today.", "It's pretty windy out there today."],
  ["I suspect its broken again.", "I suspect it's broken again."],
  ["When its finished, send me the link.", "When it's finished, send me the link."],
  ["Its really slow on my laptop.", "It's really slow on my laptop."],
  ["Its probably fine, but check anyway.", "It's probably fine, but check anyway."],
  ["I know its late, sorry.", "I know it's late, sorry."],
  ["Hey, its Mark from accounting.", "Hey, it's Mark from accounting."],
  ["Its 3 pm already?", "It's 3 pm already?"],
  ["Because its cold outside, take a coat.", "Because it's cold outside, take a coat."],
  ["I think its much better now.", "I think it's much better now."],
  ["Its as easy as that.", "It's as easy as that."],
  ["Call me when its under control.", "Call me when it's under control."],
  ["If your coming tonight, bring snacks.", "If you're coming tonight, bring snacks."],
  ["I hope your feeling better.", "I hope you're feeling better."],
  ["Let me know when your ready.", "Let me know when you're ready."],
  ["Your always welcome here.", "You're always welcome here."],
  ["Since your here, help me move this.", "Since you're here, help me move this."],
  ["Thanks for you patience.", "Thanks for your patience."],
  ["You manager will call tomorrow.", "Your manager will call tomorrow."],
  ["We need this on you calendar.", "We need this on your calendar."],
  ["The product has it quirks.", "The product has its quirks."],
  ["The old bridge has it charms, and.", "The old bridge has its charms, and."],
  ["It lid was loose.", "Its lid was loose."],
  // After a fronted clause's comma, a noun that is also a verb; "twice/times it" + noun.
  ["Once you open it, it smell fades.", "Once you open it, its smell fades."],
  ["The tent grew to three times it width.", "The tent grew to three times its width."],
  ["It shape was odd.", "Its shape was odd."],
  // Owned nouns after a verb, a modal question, "does you" and "if you phone is".
  ["Did you pack you camera yet?", "Did you pack your camera yet?"],
  ["If unsure, its best to ask.", "If unsure, it's best to ask."],
  ["Maybe its worth to wait.", "Maybe it's worth to wait."],
  ["Thanks for you help with the move.", "Thanks for your help with the move."],
];

test("its/your before a predicate and it/you before an owned noun are repaired", () => {
  for (const [input, expected] of fixes) {
    const found = scan(input);
    expect({ input, count: found.length }).toEqual({ input, count: 1 });
    expect(applyEdits(input, found[0].alternatives[0].edits)).toBe(expected);
    expect(scan(expected)).toEqual([]);
  }
});

test("possessives before a noun phrase, gerund or title stay silent", () => {
  for (const text of [
    "The house and its garden were sold.",
    "I admired its very existence.",
    "The company lost its cool.",
    "The tool and its large, ornate handle.",
    "Its working parts are rusty.",
    "Its meaning is unclear.",
    "I appreciate your helping me.",
    "Your thinking is flawed.",
    "When your meeting with Tom ended, we left.",
    "The team gave its all.",
    "Its best feature is speed.",
    "Its own engine broke.",
    "Its interesting design won awards.",
    "Is that your final answer?",
    "Pick your favorite.",
    "If your plans change, call me.",
    "When its battery dies, recharge it.",
    "I wonder if its value is null.",
    "Since its founding in 1902, the club has grown.",
    "The flag and its red, white and blue stripes.",
    "Your Honor, we object.",
    "Its more than 300 members voted.",
    "We judged it by its potential to grow.",
    "Bring me your hungry, your weary, your lost.",
    "I asked what your understanding of the plan was.",
    "This is for you mom!",
    "Thank you for your help.",
    "I made this for you kids.",
    "I will deal with it tomorrow.",
    "Sleep on it, dude.",
    "He has it covered.",
    "What has it got to do with us?",
    "Rumor has it things will change.",
    "If you recall was the plan ever approved?",
    "Go for it attitude is what we need.",
    "The IT priorities changed.",
    "If you heat it, it melts.",
    "When it rains, it pours.",
    "Once done, it works fine.",
    "I read it twice it seemed.",
    "I owe you money.",
    "I sent you photos.",
    "See you soon.",
    "I miss you guys.",
    "I love you mom.",
    "They sold you junk!",
    "The band gave its best to the fans.",
    "Wishing you rest and calm.",
    "Do you spell check your mail?",
    "The joy you feel when you swim is great.",
  ])
    expect({ text, found: scan(text).map((d) => d.original) }).toEqual({ text, found: [] });
});
