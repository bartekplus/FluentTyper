import { expect, test } from "bun:test";
import { slowestChunkMs } from "./reviewHarness";

// Time budgets (thread CPU time). bun run test runs *.timing.test.ts files serially,
// after the parallel run, so the load of other test workers does not inflate the times.

test("an Arabic chunk with many candidates scans quickly", () => {
  const slowest = (text: string) => slowestChunkMs(text, "ar_SA");
  const inputs = [
    "هذا هذان في لم ".repeat(800),
    "كلما كلما كلما ".repeat(600),
    "عن ما من ما عن من وعن ما ".repeat(500),
    `إلا ${"كلمة ".repeat(900)}فقط`,
    "31 مارس 2022 ".repeat(300),
    "في ثلاثة وثلاثون ".repeat(400),
    "الرسالة الذي كتبتها ".repeat(400),
    "قام بالعمل والتي الأكبر من ".repeat(300),
    "يعمل أخي كمدير سيما ".repeat(300),
    "القيام بالتحليل بشكل مناسب لساعات ".repeat(300),
    "رغبة شديدة لكتابة علاقة وثيقة مع ".repeat(300),
    "لم أره أبدا أثناء سوى بالله ".repeat(300),
    "فأما أن وأما أن ".repeat(400),
    "لا يخافوا ولا يخافوا خمس وعشرون صفحات ".repeat(300),
    "ما قال إلا وقال. بين ما كان يتناسب ورأيه نحن كمعلمين ".repeat(250),
    "الأرقام الأكبر من 10 المدارس الأفضل غير بالله هذه البطل ".repeat(250),
    "في الغرفة الكبير. كتاب في بيت الولد. هذا قميص قديمة الخبر التي سمعته ثلاث اجتماعات ".repeat(
      200,
    ),
  ];
  slowest(inputs.join("\n"));
  for (const text of inputs) expect(slowest(text)).toBeLessThan(100);
});
