import { expect, test } from "bun:test";
import { applyEdits } from "../../src/core/domain/grammar/review/textRanges";
import { DEFAULT_RULES, scan } from "./reviewHarness";

// Errors that the LanguageTool website finds and default Review missed (docs/languagetool-web-gaps.md).
// All sentences are our own. Only the rules a user has on by default run.
const review = (text: string) => scan(text, { enabledRules: DEFAULT_RULES });

/** Each input gets one finding, its first fix gives the expected text, and that text is clean. */
function repairs(name: string, cases: [string, string][]) {
  test.each(cases)(`${name}: repairs %s`, (input, expected) => {
    const found = review(input);
    expect({ input, found: found.map((d) => d.original) }).toEqual({
      input,
      found: [expect.any(String)],
    });
    expect(applyEdits(input, found[0].alternatives[0].edits)).toBe(expected);
    expect(review(expected).map((d) => d.original)).toEqual([]);
  });
}

function leaves(name: string, cases: string[]) {
  test.each(cases)(`${name}: leaves %s`, (text) => {
    expect(review(text).map((d) => `${d.ruleId}: ${d.original}`)).toEqual([]);
  });
}

repairs("question mark", [
  [
    "Can you send me the slides after the meeting.",
    "Can you send me the slides after the meeting?",
  ],
  [
    "Do you really think they will finish before winter.",
    "Do you really think they will finish before winter?",
  ],
  [
    "Why does every update break the printer driver.",
    "Why does every update break the printer driver?",
  ],
  ["Has anyone tried the new bus route yet.", "Has anyone tried the new bus route yet?"],
  [
    "Is there any reason we cannot ship on Friday.",
    "Is there any reason we cannot ship on Friday?",
  ],
  [
    "So what are we supposed to do now that the budget is gone.",
    "So what are we supposed to do now that the budget is gone?",
  ],
  ["How many tickets did you buy for the show.", "How many tickets did you buy for the show?"],
  ["Where did you park the car last night.", "Where did you park the car last night?"],
  ["Didn't the store close early today.", "Didn't the store close early today?"],
  [
    "I get your point, but how do you tell one candidate from another when they all say the same thing",
    "I get your point, but how do you tell one candidate from another when they all say the same thing?",
  ],
  [
    "I read the report. Can we talk about it tomorrow",
    "I read the report. Can we talk about it tomorrow?",
  ],
  ["If the build fails at night, what do we do.", "If the build fails at night, what do we do?"],
]);

leaves("question mark", [
  "So do I.",
  "Neither do we.",
  "Do it now.",
  "Do the dishes before you go out.",
  "Have them call me after lunch.",
  "Have a nice weekend.",
  "Could you please send me the file.",
  "Would you kindly close the door behind you.",
  "Should you need any help just call the front desk.",
  "Were it not for the rain we would have won.",
  "What happened was the server ran out of memory.",
  "What did it was the cold weather.",
  "What do you know.",
  "How do you do.",
  "Why don't you call her first.",
  "Have I got news for you.",
  "Can it.",
  "Would that it were so.",
  "Did you know that otters hold hands?",
  "Who would have thought.",
  "How do you choose a laptop",
  "Is coffee bad for you",
  "What I want is a quiet room.",
  "Where we live is a small town.",
  "How much is too much is a hard question.",
  "That is how we do it.",
  "Whatever you do is fine with me.",
  "However you look at it, the result is the same.",
  "I know what you mean, and I agree.",
  "Can you believe it? We won!",
  "Did you see that? It was amazing.",
  "Where did she go?",
  'He asked, "Where did you park the car."',
]);

repairs("from after prevent", [
  ["The noise prevented me sleeping all night.", "The noise prevented me from sleeping all night."],
  [
    "Nothing will stop them complaining about it.",
    "Nothing will stop them from complaining about it.",
  ],
  [
    "I get it, but who will actually try to stop him doing anything?",
    "I get it, but who will actually try to stop him from doing anything?",
  ],
  [
    "The rain discouraged us going to the beach.",
    "The rain discouraged us from going to the beach.",
  ],
  ["The court banned her driving for a year.", "The court banned her from driving for a year."],
  [
    "The new law prevents companies selling user data.",
    "The new law prevents companies from selling user data.",
  ],
  [
    "A password prevents other users opening the file.",
    "A password prevents other users from opening the file.",
  ],
  ["Please listen me for a second.", "Please listen to me for a second."],
]);

leaves("from after prevent", [
  "Nobody stopped her walking past the gate.",
  "The coat kept him waiting at the door.",
  "We need to prevent money laundering.",
  "Rest helps prevent further bleeding.",
  "The plan prevents unnecessary spending.",
  "We must prevent the people living there from building on the bank.",
  "They tried to stop him from leaving.",
  "The filter prevents spam reaching your inbox from unknown senders.",
  "I can't stop thinking about it.",
  "Try to stop worrying so much.",
]);

repairs("then and than", [
  [
    "It took longer then we expected to fix the roof.",
    "It took longer than we expected to fix the roof.",
  ],
  ["The trip cost more money then they planned.", "The trip cost more money than they planned."],
  ["I would rather walk then wait for the bus.", "I would rather walk than wait for the bus."],
  ["We'd rather stay home then go out tonight.", "We'd rather stay home than go out tonight."],
  [
    "First we eat, than we talk about the contract.",
    "First we eat, then we talk about the contract.",
  ],
  [
    "We packed the car. Than we drove to the lake.",
    "We packed the car. Then we drove to the lake.",
  ],
]);

leaves("then and than", [
  "If it gets worse then we expected nothing less.",
  "When it gets darker then we go inside.",
  "I would rather walk and then take the bus.",
  "I'd rather finish this first, then go home.",
  "It costs more, than we thought, to fix it.",
  "He is taller than we are.",
  "Nothing is better than a good nap, than we would say.",
]);

repairs("its and your as possessives", [
  [
    "The company lost it's biggest client last year.",
    "The company lost its biggest client last year.",
  ],
  ["Thanks for you're help with the move.", "Thanks for your help with the move."],
  ["Thanks for you're help.", "Thanks for your help."],
  ["I like you're new car.", "I like your new car."],
  ["Say hello to you're mother.", "Say hello to your mother."],
  ["We love it's simple design.", "We love its simple design."],
]);

leaves("its and your as possessives", [
  "I think you're right.",
  "I see you're busy.",
  "Remember you're welcome here anytime.",
  "Prove it's safe.",
  "Check it's working.",
  "Good you're home.",
  "It looks like you're new here.",
  "Call me when you're done.",
  "I forgot it's Monday.",
  "Next to it's a small shop.",
  "Glad you're back.",
  "I hear you're moving to Boston.",
  "Make sure it's clean.",
  "It drinks oil like it's water.",
  "I reckon it's time to go.",
  "We can't do that cause it's plagiarism.",
  "In this weather it's best if we stay in.",
  "I reckon it's good stuff.",
  "As to IT's budget, we will talk later.",
]);

repairs("mass nouns and fewer", [
  ["Can you give me some advices about the trip?", "Can you give me some advice about the trip?"],
  ["We need more informations before we decide.", "We need more information before we decide."],
  ["I have a lot of homeworks tonight.", "I have a lot of homework tonight."],
  [
    "There were less people at the event this year.",
    "There were fewer people at the event this year.",
  ],
]);

leaves("mass nouns and fewer", [
  "The bank sent two payment advices this week.",
  "The prosecutor filed the informations last week.",
  "The price is less taxes and fees.",
  "There is less traffic today.",
  "He is no less talented than his brother.",
  "More or less people agree.",
]);

repairs("subject-verb agreement", [
  [
    "There is three reasons why the launch failed.",
    "There are three reasons why the launch failed.",
  ],
  [
    "Everyone in the class were happy with the grade.",
    "Everyone in the class was happy with the grade.",
  ],
  ["Nobody were hurt in the crash.", "Nobody was hurt in the crash."],
  ["One of my friends live near the stadium.", "One of my friends lives near the stadium."],
  ["One of the problems are the cost.", "One of the problems is the cost."],
  ["A friend of mine have a boat.", "A friend of mine has a boat."],
  ["The police is investigating the case.", "The police are investigating the case."],
  ["The news are bad today.", "The news is bad today."],
  ["Mathematics are my favorite subject.", "Mathematics is my favorite subject."],
]);

leaves("subject-verb agreement", [
  "If everyone were to leave, the room would be empty.",
  "Everyone were to bring a dish, as agreed.",
  "Everyone have fun this weekend!",
  "I saw one of my friends live on stage.",
  "One of the people who live here is a doctor.",
  "The police were called.",
  "Luckily, a lot of mine are past the deadline.",
  "The news is out.",
  "It was one of those days that are hard to forget.",
]);

repairs("past time words", [
  ["Yesterday I go to the market.", "Yesterday I went to the market."],
  ["Last week she buys a new car.", "Last week she bought a new car."],
  ["Two days ago I see him at the store.", "Two days ago I saw him at the store."],
  ["Last year we have visited Spain for two weeks.", "Last year we visited Spain for two weeks."],
  ["I have finished the report two days ago.", "I finished the report two days ago."],
  ["Yesterday I am sick all day.", "Yesterday I was sick all day."],
]);

leaves("past time words", [
  "Yesterday I'm walking down the street and a dog runs up to me.",
  "Yesterday I think it rained.",
  "Yesterday, I believe, was the hottest day.",
  "Yesterday I put the box in the car.",
  "I have lived here since two years ago.",
  "Last year we have been to Spain twice.",
  "Yesterday we finally went home.",
  "Last night I can't sleep at all.",
]);

repairs("verb patterns", [
  ["We look forward to meet you next week.", "We look forward to meeting you next week."],
  [
    "She suggested to meet at the café near the station.",
    "She suggested meeting at the café near the station.",
  ],
  ["He suggested me to take a break.", "He suggested that I take a break."],
  ["I am used to wake up early.", "I am used to waking up early."],
  ["He is very good at make the others laugh.", "He is very good at making the others laugh."],
]);

leaves("verb patterns", [
  "I look forward to work on Monday.",
  "He suggested to management that we wait.",
  "This tool is used to cut the wood.",
  "She is good at math.",
  "I'm used to work on weekends.",
  "They suggested it to me.",
]);

repairs("prepositions", [
  ["He arrived to the airport too late.", "He arrived at the airport too late."],
  ["They are waiting the bus in the rain.", "They are waiting for the bus in the rain."],
  ["I'm agree with you on this point.", "I agree with you on this point."],
  ["He is proud for his daughter.", "He is proud of his daughter."],
  ["It reminds me to my childhood.", "It reminds me of my childhood."],
  ["In the other hand, the cost is lower.", "On the other hand, the cost is lower."],
  ["We will discuss about it tomorrow.", "We will discuss it tomorrow."],
  ["Because of I was tired, I went to bed early.", "Because I was tired, I went to bed early."],
  [
    "The meeting is postponed because of the boss is sick.",
    "The meeting is postponed because the boss is sick.",
  ],
  ["In spite the rain, we played the match.", "In spite of the rain, we played the match."],
  ["Although it was raining, but we went out.", "Although it was raining, we went out."],
]);

leaves("prepositions", [
  "We arrived to find the door locked.",
  "Please wait your turn.",
  "We had to wait the full hour.",
  "I would be proud for my son to see this.",
  "Remind me to call the bank.",
  "She held a cup in one hand. In the other hand, she held a pen.",
  "We had a long discussion about it.",
  "Because of it, we stayed home.",
  "Because of the rain, we stayed home.",
  "Although it was late, we went out, but only for an hour.",
  "Everyone will agree with you.",
]);

repairs("pronouns", [
  ["The man which lives next door is a pilot.", "The man who lives next door is a pilot."],
  ["The book what I read was great.", "The book that I read was great."],
]);

leaves("pronouns", [
  "Her and my parents met in Rome.",
  "Why is a good question.",
  "I have no idea what I want.",
  "That is the question what we should do about it, I guess.",
  "The teacher, which surprised me, smiled.",
  "The company which hired him is small.",
]);

repairs("confused words", [
  ["I don't know weather we should go or stay.", "I don't know whether we should go or stay."],
  ["We'll have to wait and see weather it works.", "We'll have to wait and see whether it works."],
  ["Please be quite during the exam.", "Please be quiet during the exam."],
  ["We had chocolate cake for desert.", "We had chocolate cake for dessert."],
  ["We where very happy with the result.", "We were very happy with the result."],
  ["I need to brake the news to her gently.", "I need to break the news to her gently."],
  ["Everyone except Tom excepted the invitation.", "Everyone except Tom accepted the invitation."],
]);

leaves("confused words", [
  "I know weather patterns well.",
  "Check the weather before you go.",
  "He was quite in demand.",
  "It is quite.",
  "They crossed the desert in a jeep.",
  "We used the desert as a test site.",
  "Press the brake gently.",
  "I liked everything except the offer.",
  "Show you where the exit is.",
]);

repairs("compounds and word forms", [
  ["I go to the gym everyday after work.", "I go to the gym every day after work."],
  ["She doesn't live here any more.", "She doesn't live here anymore."],
  ["He walked in to the room and sat down.", "He walked into the room and sat down."],
  ["Some times I just want to stay home.", "Sometimes I just want to stay home."],
  ["I'll login and fix the settings.", "I'll log in and fix the settings."],
  ["It was a once in a lifetime chance.", "It was a once-in-a-lifetime chance."],
  ["Its' a long way from here to the coast.", "It’s a long way from here to the coast."],
]);

leaves("compounds and word forms", [
  "It is an everyday item in our home.",
  "I don't want any more.",
  "He gave in to the pressure.",
  "Some times are harder than others.",
  "Enter your login and password.",
  "Once in a lifetime, you get a chance like this.",
  "It covers everything from login to logout.",
]);

repairs("question word order", [
  ["Why you didn't call me yesterday?", "Why didn't you call me yesterday?"],
  ["Where you are going this weekend?", "Where are you going this weekend?"],
  ["How much it costs to fix the screen?", "How much does it cost to fix the screen?"],
  ["Where you live now?", "Where do you live now?"],
  [
    "Could you please tell me where is the station?",
    "Could you please tell me where the station is?",
  ],
  ["I don't know what is his name.", "I don't know what his name is."],
]);

leaves("question word order", [
  "Why we do this is a long story.",
  "What you see is what you get.",
  "What you do is up to you?",
  "Where you live matters.",
  "Tell me where is the best place to eat?",
  "Do you know who is coming?",
  "Why do you ask?",
  "Where they live? I have no idea.",
]);

repairs("adverb form", [
  ["He drives very careful in the snow.", "He drives very carefully in the snow."],
  ["She sings beautiful at every concert.", "She sings beautifully at every concert."],
  ["You did that very good, thank you.", "You did that very well, thank you."],
  ["The plan worked perfect in the end.", "The plan worked perfectly in the end."],
]);

leaves("adverb form", [
  "It feels good to be home.",
  "Drive slow near the school.",
  "Let's do good in the world.",
  "They cook good food.",
  "She did good work today.",
  "Act natural.",
]);

repairs("comma after an opening word", [
  ["Yes I can help you with that.", "Yes, I can help you with that."],
  ["Well I guess we can try again tomorrow.", "Well, I guess we can try again tomorrow."],
  ["No I don't think so.", "No, I don't think so."],
  [
    "However the results were not as good as we hoped.",
    "However, the results were not as good as we hoped.",
  ],
]);

leaves("comma after an opening word", [
  "No one knows the answer.",
  "No the other one, please.",
  "However large the risk, we go on.",
  "Well done!",
  "Yes, I can.",
]);

repairs("will in time clauses", [
  ["When I will finish, I will call you.", "When I finish, I will call you."],
  ["If he will call, tell him I'm out.", "If he calls, tell him I'm out."],
  ["I will call you when I will arrive.", "I will call you when I arrive."],
  ["We'll start as soon as she will get here.", "We'll start as soon as she gets here."],
]);

leaves("will in time clauses", [
  "I don't know when he will arrive.",
  "If you will follow me, I will show you the room.",
  "I'm not sure if they will come.",
  "When will you finish?",
  "Ask him when he will be back.",
]);

repairs("a and an", [
  [
    "They hired a engineer from the local university.",
    "They hired an engineer from the local university.",
  ],
  ["She works as an teacher in a small village.", "She works as a teacher in a small village."],
]);

leaves("a and an", ["Set option a early.", "We hired an engineer.", "She works as a teacher."]);

repairs("since with a present verb", [
  ["I know him since we were children.", "I have known him since we were children."],
  ["I am living here since 2015.", "I have been living here since 2015."],
  ["She has a fever since this morning.", "She has had a fever since this morning."],
  ["We live here since March.", "We have lived here since March."],
]);

leaves("since with a present verb", [
  "I trust him since he was honest with me.",
  "I have known him since we were children.",
  "It has rained since Monday.",
  "Since 2015, we live in Berlin and love it.",
]);

repairs("other learner errors", [
  ["Thanks God it's Friday.", "Thank God it's Friday."],
  ["My all friends came to the party.", "All my friends came to the party."],
  ["I very like this song.", "I really like this song."],
  ["It's depend on the price.", "It depends on the price."],
  ["He musts finish the report.", "He must finish the report."],
  ["Peoples are angry about the new tax.", "People are angry about the new tax."],
  ["It's a 10 minutes walk from here.", "It's a 10-minute walk from here."],
  ["We were made wait for an hour.", "We were made to wait for an hour."],
  ["He told that he would be late.", "He said that he would be late."],
  ["She said me that she was tired.", "She told me that she was tired."],
  ["Thank you John for the quick reply.", "Thank you, John, for the quick reply."],
  ["Unfortunately the shop was already closed.", "Unfortunately, the shop was already closed."],
  ["They found a lot of evidences against him.", "They found a lot of evidence against him."],
]);

leaves("other learner errors", [
  "She gave it her all.",
  "It was my all-time favorite.",
  "He was made head of the team.",
  "I very much like this song.",
  "The peoples of Europe are diverse.",
  "It's a 10-minute walk from here.",
  "The cake was made ready for the party.",
  "He told that story twice.",
  "They said that we could stay.",
  "Thank you all for coming.",
  "I received the thank you mail.",
  "Select your All Macros group.",
  "Thank you so much.",
  "The musts of travel are few.",
]);

repairs("however between clauses", [
  [
    "I agree with this statement, however some people disagree.",
    "I agree with this statement; however, some people disagree.",
  ],
]);

leaves("however between clauses", [
  "The plan, however, failed.",
  "We will finish, however long it takes.",
  "It is fine, however you look at it.",
]);
