import { expect, test } from "bun:test";
import { applyEdits } from "../../src/core/domain/grammar/review/textRanges";
import type { ReviewOptions } from "../../src/core/domain/grammar/review/types";
import { scan as reviewScan } from "./reviewHarness";

// Lookalike words chosen by their slot (englishConfusedWords) and the fixed rows of confusions1.
const OWN = new Set(["englishConfusedWords", "englishPhraseCorrections", "englishClosedCompounds"]);
function scan(text: string, options: Partial<ReviewOptions> = {}) {
  return reviewScan(text, options).filter((d) => OWN.has(d.ruleId));
}
const repairs = (text: string) =>
  scan(text).flatMap((d) => d.alternatives.map((a) => applyEdits(text, a.edits)));

// [typed, the repaired text one of the offered alternatives must produce]
const positives: [string, string][] = [
  // A noun in a verb slot: after a subject, a modal, "to" or an imperative.
  ["Could you advice me on the setup?", "Could you advise me on the setup?"],
  ["Our team will advice the client tomorrow.", "Our team will advise the client tomorrow."],
  ["Please advice how to proceed.", "Please advise how to proceed."],
  ["We belief the patch is safe.", "We believe the patch is safe."],
  ["Remember to slowly breath through the nose.", "Remember to slowly breathe through the nose."],
  ["They intent to ship it on Friday.", "They intend to ship it on Friday."],
  ["Do you intent to merge this?", "Do you intend to merge this?"],
  ["The guide tries to emphasis the risks.", "The guide tries to emphasize the risks."],
  ["The server should response within a second.", "The server should respond within a second."],
  ["I thing the cache is stale.", "I think the cache is stale."],
  ["What does everybody thing about it?", "What does everybody think about it?"],
  ["We need to thing about naming.", "We need to think about naming."],
  ["And never thing about it again.", "And never think about it again."],
  ["How much does it weight?", "How much does it weigh?"],
  ["How much do you weight?", "How much do you weigh?"],
  // A verb in a noun slot.
  ["Thanks for the good advise.", "Thanks for the good advice."],
  ["That is a common believe among users.", "That is a common belief among users."],
  ["Hold a deep breathe and count.", "Hold a deep breath and count."],
  ["My intend was to help.", "My intent was to help."],
  // effect/affect.
  ["Heavy rain can effect the schedule.", "Heavy rain can affect the schedule."],
  ["Long queues badly effect our response times.", "Long queues badly affect our response times."],
  ["Will this outage effect the release?", "Will this outage affect the release?"],
  ["The patch had a big affect on startup.", "The patch had a big effect on startup."],
  ["The new rule is now in affect.", "The new rule is now in effect."],
  ["The plan comes into affect in May.", "The plan comes into effect in May."],
  ["The side affects were mild.", "The side effects were mild."],
  ["The placebo affect is real.", "The placebo effect is real."],
  // be + adjective.
  ["I'm worry about the deadline.", "I'm worried about the deadline."],
  ["She is concern about privacy.", "She is concerned about privacy."],
  ["They were shock by the news.", "They were shocked by the news."],
  ["He's bias toward the old design.", "He's biased toward the old design."],
  // Other lookalikes.
  ["You must safe the draft first.", "You must save the draft first."],
  ["Is it save to delete the folder?", "Is it safe to delete the folder?"],
  ["She bough two tickets.", "She bought two tickets."],
  ["We dint finish the tests.", "We didn't finish the tests."],
  ["I fell like it is too slow.", "I feel like it is too slow."],
  ["Please fell free to ask.", "Please feel free to ask."],
  ["The result was quiet surprising.", "The result was quite surprising."],
  ["It happens quiet often.", "It happens quite often."],
  ["I can't quiet hear you.", "I can't quite hear you."],
  ["The room was very quite.", "The room was very quiet."],
  ["After the restart everything was find.", "After the restart everything was fine."],
  ["I hop you enjoy the release.", "I hope you enjoy the release."],
  ["We hoped on the train to Lyon.", "We hopped on the train to Lyon."],
  ["Mia cant open the file.", "Mia can't open the file."],
  ["Read the summery of the meeting.", "Read the summary of the meeting."],
  ["Check the summery-table below.", "Check the summary-table below."],
  ["Theses files are generated.", "These files are generated."],
  ["The press tried to brandish her a liar.", "The press tried to brand her a liar."],
  ["They denied our offer of help.", "They declined our offer of help."],
  [
    "We had to dissemble the printer to clean it.",
    "We had to disassemble the printer to clean it.",
  ],
  ["Take whatever that you need.", "Take whatever you need."],
  ["Thank whoever who fixed it.", "Thank whoever fixed it."],
  ["Everyday we learn something.", "Every day we learn something."],
  ["This build is slower that the last one.", "This build is slower than the last one."],
  ["He was stupider then her but kind.", "He was stupider than her but kind."],
  ["We meet now and than at the cafe.", "We meet now and then at the cafe."],
  ["I guess its June 3.", "I guess it's June 3."],
  ["The car lost it's 3rd gear.", "The car lost its 3rd gear."],
  ["It's handle is broken.", "Its handle is broken."],
  ["The tool let's us skip that step.", "The tool lets us skip that step."],
  ["So lets begin with the basics.", "So let's begin with the basics."],
  ["I think you're dog was barking.", "I think your dog was barking."],
  ["Were a small team.", "We're a small team."],
  ["Can you open the lights?", "Can you turn on the lights?"],
  ["She opened the radio and sat down.", "She turned on the radio and sat down."],
  ["We roller skated along the pier.", "We roller-skated along the pier."],
  ["The army went rouge overnight.", "The army went rogue overnight."],
  ["She lives in baton rogue now.", "She lives in baton rouge now."],
  ["Follow the training regiment closely.", "Follow the training regimen closely."],
  ["Is everyone over they're ready?", "Is everyone over there ready?"],
  ["She wore a light summary dress.", "She wore a light summery dress."],
];

test.each(positives)("repairs %s", (typed, expected) => {
  expect(repairs(typed)).toContain(expected);
});

// Correct forms and look-alikes stay clean.
const silent = [
  "I'll give you advice on that.",
  "Should intent be part of the schema?",
  "They were intent on winning.",
  "Do breath exercises daily.",
  "We weight each sample by its size.",
  "The thing I need is time.",
  "She will do the same thing tomorrow.",
  "I strongly advise against it.",
  "Some believe it works.",
  "Just breathe.",
  "These changes affect performance.",
  "The tool is meant to effect change in the team.",
  "Research into affect regulation continues.",
  "One side affects the other.",
  "Their side effects were mild.",
  "It may have side effects it cannot predict.",
  "Her flat affect worried the doctor.",
  "They're shock jocks on the radio.",
  "Keep your data safe.",
  "It is safe to delete the folder.",
  "A quiet little town.",
  "The baby won't quiet down.",
  "The bough broke under the snow.",
  "By dint of hard work she won.",
  "The leaves fell like rain.",
  "He fell asleep at once.",
  "I fell down the stairs.",
  "Everything is fine.",
  "I hop on the bike every morning.",
  "I hope on the train there's wifi.",
  "The cant of the roof is steep.",
  "Cant cant be the same as jargon.",
  "A summery dress for summer days.",
  "The weather is summery today.",
  "Their theses topics vary.",
  "He brandished a sword.",
  "They deny the offer was ever made.",
  "Whatever that means, we tried.",
  "We use it in everyday life.",
  "It is better that you go.",
  "It makes it clearer that the program referred to is ours.",
  "I met her earlier then him.",
  "I think its handle is broken.",
  "The app lets users export data.",
  "Let chance decide.",
  "for (let d = new Date(); d; ) {}",
  "You're welcome is what he said.",
  "Were the results good?",
  "Open the TV app first.",
  "The roller skated across the stage.",
  "She wore rouge on her cheeks.",
  "The regiment marched home.",
  "The summary dress code is strict.",
  'The style guide lists "I cant go" as an example.',
  "The weather was nice. It\nwere a long day anyway.",
];

test.each(silent)("stays silent on %s", (text) => {
  expect(scan(text).filter((d) => d.ruleId === "englishConfusedWords")).toEqual([]);
});

test("user words, mixed case, other languages and wrapped lines", () => {
  expect(scan("I thing so.", { userDictionary: ["thing"] })).toEqual([]);
  expect(scan("I tHing so.")).toEqual([]);
  expect(scan("I thing so.", { lang: "de_DE" })).toEqual([]);
  // A wrapped line continues the sentence; a list item does not.
  expect(repairs("We\nroller skated home.")).toContain("We\nroller-skated home.");
  expect(repairs("Notes:\n- were a team")).toEqual([]);
});

test("offers a choice where the writer decides, and keeps case", () => {
  const [deny] = scan("We deny the offer.");
  expect(deny.requiresChoice).toBe(true);
  expect(deny.alternatives.map((a) => applyEdits("We deny the offer.", a.edits))).toEqual([
    "We decline the offer.",
    "We reject the offer.",
  ]);
  expect(repairs("I THING SO.")).toContain("I THINK SO.");
  expect(repairs("Open the TV, please.")).toContain("Turn on the TV, please.");
});
