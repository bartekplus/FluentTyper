/**
 * Builds promo v2 (STORYBOARD.md v2, 60 s, dark) as HyperFrames HTML from the verified
 * captures in assets/ui/ (capture-v2.ts, capture-ai.ts, capture-wordpress.ts).
 *
 *   bun scripts/compose-v2.ts
 *
 * Writes index.html and compositions/frames/NN-*.html. Regeneration overwrites them:
 * edit this file, not the output. Every typed line repeats, letter for letter, the text
 * the product typed or fixed in the capture of that moment.
 */
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const dir = resolve(import.meta.dir, "..");
type Box = { x: number; y: number; width: number; height: number };
type State = {
  name: string;
  text: string;
  boxes: { popup: Box | null; card: Box | null; panel: Box | null };
};
const evidence = JSON.parse(
  await readFile(resolve(dir, "evidence/interactions-v2.json"), "utf8"),
) as {
  states: State[];
  points: Record<string, { x: number; y: number }>;
};
const state = (name: string) => {
  const found = evidence.states.find((s) => s.name === name);
  if (!found) throw new Error(`No capture state ${name}`);
  return found;
};
const box = (name: string, kind: "popup" | "card" | "panel") => {
  const found = state(name).boxes[kind];
  if (!found) throw new Error(`No ${kind} box in ${name}`);
  return found;
};
const pad = (b: Box, p: number): Box => ({
  x: b.x - p,
  y: b.y - p,
  width: b.width + 2 * p,
  height: b.height + 2 * p,
});

const W = 1920;
const H = 1080;
const CSS = `
:root{--stage:#000;--lift:#0b0b0d;--surface:#16161a;--hair:#2a2a30;--ink:#f5f5f7;--ink2:#a1a1a6;--ink3:#6e6e73;--cyan:#1bd9fd;--blue:#1fa7f3}
*{box-sizing:border-box}html,body{margin:0;width:${W}px;height:${H}px;overflow:hidden;background:var(--stage);color:var(--ink);font-family:system-ui,-apple-system,sans-serif}
#root{position:relative;width:100%;height:100%;overflow:hidden;background:var(--stage)}
.clip{position:absolute;inset:0}
.ground{position:absolute;inset:0;background:radial-gradient(ellipse at 50% 45%,var(--lift) 0%,var(--stage) 70%)}
.line{position:absolute;left:0;right:0;text-align:center;font-weight:600;letter-spacing:-0.02em;line-height:1.15;white-space:pre}
.typed{font-size:69px}.h1{font-size:130px;font-weight:700;letter-spacing:-0.035em;line-height:1.02}.h2{font-size:88px;font-weight:700;letter-spacing:-0.03em}
.display{font-size:182px;font-weight:800;letter-spacing:-0.045em;line-height:.95}.lead{font-size:36px;font-weight:500;color:var(--ink2);letter-spacing:-0.01em}
.foot{font-size:22px;font-weight:500;color:var(--ink3);letter-spacing:.01em}
.ch{position:relative;opacity:0}.cr{position:absolute;right:-4px;top:.12em;width:4px;height:.92em;border-radius:2px;background:var(--cyan);display:none}
.c0 .cr{right:auto;left:-6px}
.word[data-acted="1"],.acted{background:linear-gradient(90deg,var(--cyan),var(--blue));-webkit-background-clip:text;background-clip:text;color:transparent}
.glass{position:absolute;overflow:hidden;border:1px solid var(--hair);border-radius:18px;background:#fff;box-shadow:0 40px 120px rgba(0,0,0,.6),0 0 80px rgba(31,167,243,.22)}
.glass img{position:absolute;display:block;max-width:none}
.key{position:absolute;padding:20px 34px;border-radius:16px;background:var(--surface);border:1px solid var(--hair);font-size:34px;font-weight:650;color:var(--ink);box-shadow:0 0 50px rgba(27,217,253,.35);white-space:nowrap}
.label{position:absolute;left:0;right:0;text-align:center;font-size:30px;font-weight:600;color:var(--ink2);letter-spacing:.02em}
.pointer{position:absolute;left:0;top:0;width:44px;height:58px;filter:drop-shadow(0 3px 6px rgba(0,0,0,.6));z-index:20}
.logo{position:absolute;width:168px;height:168px}
`;

// ---------------------------------------------------------------- building blocks

let layer = 0;
const clip = (start: number, duration: number, track: number, inner: string) =>
  `<div id="L${layer++}" class="clip" data-start="${start}" data-duration="${duration}" data-track-index="${track}">${inner}</div>`;

/** A capture region (CSS px of a 1200-wide capture, or `cssWidth` for an element shot) as lit glass. */
function crop(
  id: string,
  name: string,
  region: Box,
  at: { x: number; y: number; scale: number },
  cssWidth = 1200,
  style = "",
) {
  const k = at.scale;
  return `<div id="${id}" class="glass" style="left:${at.x}px;top:${at.y}px;width:${region.width * k}px;height:${region.height * k}px;${style}"><img src="assets/ui/${name}.png" alt="FluentTyper capture: ${name}" style="width:${cssWidth * k}px;left:${-region.x * k}px;top:${-region.y * k}px"></div>`;
}
const FULL: Box = { x: 0, y: 0, width: 1200, height: 640 };
/** A whole 1200×640 capture, centered horizontally at `width` px. */
const plate = (id: string, name: string, width: number, y: number, style = "") =>
  crop(id, name, FULL, { x: (W - width) / 2, y, scale: width / 1200 }, 1200, style);
const centered = (region: Box, scale: number, y?: number) => ({
  x: (W - region.width * scale) / 2,
  y: y ?? (H - region.height * scale) / 2,
  scale,
});

/** A typed line: laid out whole but hidden, so it never jumps while it grows. */
function line(
  id: string,
  parts: Array<string | { word: string }>,
  cls: string,
  top: number,
  extra = "",
) {
  let i = 0;
  const chars = (text: string) =>
    [...text]
      .map(
        (c) =>
          `<span id="${id}-c${i++}" class="ch">${c === " " ? " " : c}<i class="cr"></i></span>`,
      )
      .join("");
  const body = parts
    .map((part, n) =>
      typeof part === "string"
        ? chars(part)
        : `<span id="${id}-w${n}" class="word">${chars(part.word)}</span>`,
    )
    .join("");
  return {
    html: `<div id="${id}" class="line ${cls}" style="top:${top}px;${extra}"><span id="${id}-c-1" class="ch c0"><i class="cr"></i></span>${body}</div>`,
    length: i,
  };
}
/** Reveals letters [from, to) of a line, one every `step` s from `t0`; the caret follows. */
function typeOn(id: string, from: number, to: number, t0: number, step: number): string {
  let out = "";
  for (let i = from; i < to; i++) {
    const t = +(t0 + (i - from) * step).toFixed(3);
    out += `tl.set("#${id}-c${i}",{opacity:1},${t});tl.set("#${id}-c${i} .cr",{display:"block"},${t});tl.set("#${id}-c${i - 1} .cr",{display:"none"},${t});`;
  }
  return out;
}
const showAll = (id: string, n: number, t: number) =>
  `tl.set("#${id} .ch",{opacity:1},${t});` + (n ? "" : "");
const caretAt = (id: string, i: number, t: number) =>
  `tl.set("#${id}-c${i} .cr",{display:"block"},${t});`;
const caretOff = (id: string, i: number, t: number) =>
  `tl.set("#${id}-c${i} .cr",{display:"none"},${t});`;
function blink(id: string, i: number, from: number, to: number): string {
  let out = "";
  for (let t = from, on = false; t < to; t += 0.53, on = !on)
    out += `tl.set("#${id}-c${i} .cr",{opacity:${on ? 1 : 0}},${t.toFixed(2)});`;
  return out;
}
const keyPress = (id: string, t: number) =>
  `tl.fromTo("#${id}",{scale:1},{scale:.9,duration:.1,ease:"power2.in",immediateRender:false},${t - 0.1});tl.to("#${id}",{scale:1,duration:.22,ease:"power2.out"},${t});`;
const appear = (sel: string, t: number, d = 0.35, from = "{opacity:0,y:14}") =>
  `tl.fromTo("${sel}",${from},{opacity:1,y:0,duration:${d},ease:"power2.out"},${t});`;
const leave = (sel: string, t: number, d = 0.3, to = "{opacity:0,y:-24}") =>
  `tl.to("${sel}",{...${to},duration:${d},ease:"power2.in"},${t});`;
const pointer = (id: string) =>
  `<svg id="${id}" class="pointer" data-layout-ignore viewBox="0 0 32 42"><path d="M2 2L2 32L10 25L17 39L23 36L16 23L28 23Z" fill="#111" stroke="#fff" stroke-width="2"/></svg>`;

type Scene = { id: string; file: string; start: number; d: number; html: string; motion: string };
const scenes: Scene[] = [];
const scene = (id: string, file: string, start: number, d: number, html: string, motion: string) =>
  scenes.push({ id, file, start, d, html, motion });

// ---------------------------------------------------------------- 01 caret (0–2)
{
  const l = line("f1", [""], "typed", 470);
  scene(
    "caret",
    "01-caret",
    0,
    2,
    clip(0, 2, 2, l.html),
    caretAt("f1", -1, 0) + blink("f1", -1, 0.4, 2),
  );
}

// ---------------------------------------------------------------- 02 typed with Tab (2–5)
{
  const text = state("v2-open-done").text; // "This message was typed with Tab."
  if (text !== "This message was typed with Tab.") throw new Error(`Opening text: ${text}`);
  const l = line("f2", ["This ", { word: "message" }, " was typed with Tab."], "typed", 440);
  const popup = pad(box("v2-open-popup", "popup"), 6);
  const motion =
    caretAt("f2", -1, 0) +
    typeOn("f2", 0, 8, 0.05, 0.1) + // "This mes"
    appear("#f2-popup", 0.85, 0.25, "{opacity:0,y:-8}") +
    keyPress("f2-key", 1.45) +
    `tl.set("#f2-popup",{opacity:0},1.5);` +
    typeOn("f2", 8, 12, 1.5, 0.02) + // "sage"
    `tl.set("#f2-w1",{attr:{"data-acted":"1"}},1.5);` +
    typeOn("f2", 12, l.length, 1.62, 0.05) +
    blink("f2", l.length - 1, 2.6, 3) +
    leave("#f2", 2.7, 0.3) +
    leave("#f2-key", 2.6, 0.2, "{opacity:0}");
  scene(
    "typed",
    "02-typed",
    2,
    3,
    clip(0, 3, 2, l.html) +
      clip(
        0,
        3,
        3,
        crop("f2-popup", "v2-open-popup", popup, { x: 760, y: 540, scale: 2.2 }, 1200, "opacity:0"),
      ) +
      clip(0, 3, 4, `<div id="f2-key" class="key" style="left:1160px;top:610px">Tab</div>`),
    motion,
  );
}

// ---------------------------------------------------------------- 03 popup (5–8)
{
  const p = box("v2-popup", "popup");
  const origin = `${((p.x / 1200) * 100).toFixed(1)}% ${((p.y / 640) * 100).toFixed(1)}%`;
  const html =
    clip(0, 1.75, 1, plate("f3-a", "v2-popup", 1344, 182, `transform-origin:${origin}`)) +
    clip(
      1.75,
      1.25,
      1,
      plate("f3-b", "v2-popup-accepted", 1344, 182, `transform-origin:${origin}`),
    ) +
    clip(0, 3, 4, `<div id="f3-key" class="key" style="left:1690px;top:820px">Tab</div>`);
  const motion =
    appear("#f3-a", 0, 0.45, "{opacity:0,y:30}") +
    `tl.fromTo("#f3-a",{scale:1},{scale:1.14,duration:1.75,ease:"power1.inOut",immediateRender:false},0);` +
    `tl.fromTo("#f3-b",{scale:1.14},{scale:1.2,duration:1.25,ease:"power1.out"},1.75);` +
    appear("#f3-key", 1.0, 0.3, "{opacity:0}") +
    keyPress("f3-key", 1.75);
  scene("popup", "03-popup", 5, 3, html, motion);
}

// ---------------------------------------------------------------- 04 inline (8–10.5)
{
  const html =
    clip(0, 1.35, 1, plate("f4-a", "v2-inline", 1344, 182)) +
    clip(1.35, 1.15, 1, plate("f4-b", "v2-inline-accepted", 1344, 182)) +
    clip(0, 2.5, 4, `<div id="f4-key" class="key" style="left:1690px;top:820px">Tab</div>`);
  const motion =
    `tl.fromTo("#f4-a",{scale:1.06},{scale:1.1,duration:1.35,ease:"none"},0);` +
    `tl.set("#f4-b",{scale:1.1},1.35);` +
    keyPress("f4-key", 1.35) +
    leave("#f4-b", 2.05, 0.4, "{x:-260,opacity:0}") +
    leave("#f4-key", 2.05, 0.25, "{opacity:0}");
  scene("inline", "04-inline", 8, 2.5, html, motion);
}

// ---------------------------------------------------------------- 05 saved reply (10.5–13.5)
{
  const expanded = state("v2-snippet-expanded").text.trim();
  const chip = line("f5a", [{ word: "callMe" }], "typed", 330);
  const full = line("f5b", [expanded], "typed", 470);
  const popup = pad(box("v2-snippet", "popup"), 6);
  const motion =
    `tl.set("#f5a-w0",{attr:{"data-acted":"1"}},0);` +
    caretAt("f5a", -1, 0) +
    typeOn("f5a", 0, 6, 0.05, 0.1) +
    appear("#f5-popup", 0.75, 0.25, "{opacity:0,y:-8}") +
    keyPress("f5-key", 1.4) +
    `tl.set("#f5-popup",{opacity:0},1.45);` +
    caretOff("f5a", 5, 1.45) +
    `tl.to("#f5a",{opacity:.35,duration:.3},1.45);` +
    showAll("f5b", full.length, 1.5) +
    appear("#f5b", 1.5, 0.35, "{opacity:0,y:20}") +
    leave("#f5a,#f5b", 2.6, 0.35, "{opacity:0,y:30}") +
    leave("#f5-key", 2.5, 0.2, "{opacity:0}");
  scene(
    "reply",
    "05-reply",
    10.5,
    3,
    clip(0, 3, 2, chip.html + full.html) +
      clip(
        0,
        3,
        3,
        crop("f5-popup", "v2-snippet", popup, { x: 700, y: 520, scale: 2.0 }, 1200, "opacity:0"),
      ) +
      clip(0, 3, 4, `<div id="f5-key" class="key" style="left:1380px;top:340px">Tab</div>`),
    motion,
  );
}

// ---------------------------------------------------------------- 06 draft (13.5–16)
{
  const draft = state("v2-review-highlights").text;
  const words = line("f6", [draft], "typed", 470, "font-size:52px");
  const region: Box = { x: 10, y: 120, width: 830, height: 220 };
  const teh = evidence.points.teh;
  const origin = `${(((teh.x - region.x) / region.width) * 100).toFixed(1)}% ${(((teh.y - region.y) / region.height) * 100).toFixed(1)}%`;
  const html =
    clip(0, 0.6, 2, words.html) +
    clip(
      0,
      2.5,
      4,
      `<div id="f6-key" class="key" style="left:760px;top:640px">Alt + Shift + R</div>`,
    ) +
    clip(
      0.6,
      1.9,
      1,
      crop(
        "f6-plate",
        "v2-review-highlights",
        region,
        centered(region, 2.0),
        1200,
        `transform-origin:${origin}`,
      ),
    );
  const motion =
    showAll("f6", words.length, 0) +
    keyPress("f6-key", 0.4) +
    `tl.fromTo("#f6-plate",{scale:1},{scale:1.1,duration:1.9,ease:"power1.in"},0.6);` +
    leave("#f6-key", 0.6, 0.25, "{opacity:0,y:20}");
  scene("draft", "06-draft", 13.5, 2.5, html, motion);
}

// ---------------------------------------------------------------- 07 card (16–19)
{
  const raw = box("v2-review-card", "card");
  const card: Box = { x: raw.x - 10, y: raw.y + 2, width: raw.width + 20, height: raw.height + 8 };
  const k = 2.6;
  const at = centered(card, k, 150);
  const apply = evidence.points.apply;
  const ax = at.x + (apply.x - card.x) * k;
  const ay = at.y + (apply.y - card.y) * k;
  const strip: Box = { x: 10, y: 160, width: 1000, height: 80 };
  // The "one fixed" capture has the Review panel from x 848: stop before it.
  const narrow: Box = { ...strip, width: 830 };
  const html =
    clip(0, 1.8, 1, crop("f7-card", "v2-review-card", card, at)) +
    clip(0, 1.8, 4, pointer("f7-ptr")) +
    clip(1.8, 1.2, 1, crop("f7-fixed", "v2-review-one-fixed", narrow, centered(narrow, 1.9)));
  const motion =
    appear("#f7-card", 0, 0.35, "{opacity:0,scale:.96}") +
    `tl.fromTo("#f7-ptr",{x:${ax + 220},y:${ay + 160},opacity:0},{x:${ax - 8},y:${ay - 6},opacity:1,duration:.8,ease:"power2.out"},0.5);` +
    `tl.to("#f7-ptr",{scale:.88,duration:.08},1.55);tl.to("#f7-ptr",{scale:1,duration:.15},1.65);` +
    appear("#f7-fixed", 1.8, 0.35, "{opacity:0,scale:1.04}");
  scene("card", "07-card", 16, 3, html, motion);
}

// ---------------------------------------------------------------- 08 fix all safe (19–22)
{
  const strip: Box = { x: 10, y: 160, width: 1000, height: 80 };
  // The "one fixed" capture has the Review panel from x 848: stop before it.
  const narrow: Box = { ...strip, width: 830 };
  const panelBox = box("v2-review-one-fixed", "panel");
  const panel: Box = { x: 0, y: 0, width: panelBox.width, height: panelBox.height };
  const doneBox = box("v2-review-safe-fixed", "panel");
  const k = 1.75;
  const fix = evidence.points.fixAll;
  const px = 1180 + (fix.x - panelBox.x) * k;
  const py = 110 + (fix.y - panelBox.y) * k;
  const html =
    clip(
      0,
      1.2,
      1,
      crop("f8-strip-a", "v2-review-one-fixed", narrow, { x: 40, y: 470, scale: 1.1 }),
    ) +
    clip(
      1.15,
      1.85,
      1,
      crop("f8-strip-b", "v2-review-safe-fixed", strip, { x: 40, y: 470, scale: 1.1 }),
    ) +
    clip(
      0,
      1.2,
      3,
      crop("f8-panel-a", "v2-review-panel", panel, { x: 1180, y: 110, scale: k }, panelBox.width),
    ) +
    clip(
      1.2,
      1.8,
      3,
      crop("f8-panel-b", "v2-review-safe-fixed", doneBox, { x: 1180, y: 110, scale: k }),
    ) +
    clip(0, 1.3, 4, pointer("f8-ptr"));
  const motion =
    appear("#f8-panel-a", 0, 0.4, "{opacity:0,x:120}") +
    `tl.fromTo("#f8-ptr",{x:${px - 260},y:${py - 120},opacity:0},{x:${px - 8},y:${py - 6},opacity:1,duration:.6,ease:"power2.out"},0.35);` +
    `tl.to("#f8-ptr",{scale:.88,duration:.08},1.02);tl.to("#f8-ptr",{scale:1,duration:.15},1.12);` +
    appear("#f8-strip-b", 1.15, 0.3, "{opacity:.4}") +
    leave("#f8-panel-b", 2.6, 0.35, "{x:140,opacity:0}");
  scene("fixall", "08-fix-all", 19, 3, html, motion);
}

// ---------------------------------------------------------------- 09 style (22–24.5)
{
  const card = box("v2-style-card", "card");
  const region: Box = {
    x: 10,
    y: 160,
    width: Math.max(660, card.x + card.width + 20 - 10),
    height: card.y + card.height + 16 - 160,
  };
  const html = clip(0, 2.5, 1, crop("f9", "v2-style-card", region, centered(region, 1.85)));
  scene(
    "style",
    "09-style",
    22,
    2.5,
    html,
    appear("#f9", 0, 0.4, "{opacity:0,y:24}") +
      `tl.fromTo("#f9",{scale:1},{scale:1.05,duration:2.5,ease:"none",immediateRender:false},0);`,
  );
}

// ---------------------------------------------------------------- 10 every language (24.5–29.5)
{
  const languages: Array<[string, string]> = [
    ["es", "Gracias por el informe."],
    ["de", "Danke für den Bericht."],
    ["pl", "Dziękuję za raport."],
    ["el", "Ευχαριστώ για την αναφορά."],
    ["ar", "شكرًا على التقرير."],
  ];
  let html = "";
  languages.forEach(([code, text], n) => {
    if (!state(`v2-lang-${code}`).text.startsWith(text)) throw new Error(`Language text ${code}`);
    const start = +(n * 0.8).toFixed(2);
    const header: Box = { x: 0, y: 0, width: 340, height: 82 };
    html +=
      clip(
        start,
        0.8,
        2,
        `<div class="line typed" style="top:470px" ${code === "ar" ? 'dir="rtl"' : ""}>${text}</div>`,
      ) +
      clip(
        start,
        0.8,
        3,
        crop(
          `f10-menu-${code}`,
          `v2-lang-${code}-panel`,
          header,
          { x: 1290, y: 110, scale: 1.55 },
          340,
        ),
      );
  });
  html += clip(
    4.0,
    1.0,
    2,
    `<div id="f10-count" class="line h2" style="top:440px"><span class="acted">10</span> languages</div>`,
  );
  scene(
    "languages",
    "10-languages",
    24.5,
    5,
    html,
    appear("#f10-count", 4.0, 0.35, "{opacity:0,y:20}"),
  );
}

// ---------------------------------------------------------------- 11 everywhere (29.5–35.5)
{
  const editors: Array<[string, string]> = [
    ["v2-popup", "Mail"],
    ["v2-editor-wordpress", "WordPress"],
    ["v2-editor-notes", "Notes"],
  ];
  let html = "";
  editors.forEach(([name, label], n) => {
    const start = n * 1.5;
    html +=
      clip(start, 1.5, 1, plate(`f11-${n}`, name, 1500, 120)) +
      clip(start, 1.5, 3, `<div class="label" style="top:950px">${label}</div>`);
  });
  const l = line("f11", ["It works where you write."], "typed", 420);
  html += clip(
    4.5,
    1.5,
    2,
    l.html +
      `<div id="f11-also" class="line lead" style="top:540px">Mail · WordPress · Google Docs · and more</div>`,
  );
  const motion =
    editors
      .map(
        (_, n) =>
          `tl.fromTo("#f11-${n}",{scale:1.02},{scale:1.06,duration:1.5,ease:"none"},${n * 1.5});`,
      )
      .join("") +
    caretAt("f11", -1, 4.5) +
    typeOn("f11", 0, l.length, 4.55, 0.025) +
    appear("#f11-also", 5.2, 0.3, "{opacity:0}");
  scene("everywhere", "11-everywhere", 29.5, 6, html, motion);
}

// ---------------------------------------------------------------- 12 local AI (35.5–40.5)
{
  const ai: Box = { x: 820, y: 0, width: 380, height: 455 };
  const html =
    clip(0, 1.4, 1, plate("f12-a", "v2-ai-before", 1344, 160)) +
    clip(1.4, 3.6, 1, crop("f12-b", "v2-ai-rewrite", ai, centered(ai, 2.0, 40))) +
    clip(
      1.4,
      3.6,
      3,
      `<div id="f12-foot" class="line foot" style="top:1000px">Optional · Chrome and Edge · runs on your device</div>`,
    );
  const motion =
    appear("#f12-b", 1.4, 0.4, "{opacity:0,scale:.97}") +
    `tl.fromTo("#f12-b",{scale:1},{scale:1.04,duration:3.6,ease:"none",immediateRender:false},1.4);` +
    appear("#f12-foot", 1.9, 0.4, "{opacity:0}") +
    leave("#f12-b,#f12-foot", 4.7, 0.3, "{opacity:0}");
  scene("localai", "12-local-ai", 35.5, 5, html, motion);
}

// ---------------------------------------------------------------- 13 your device (40.5–44)
scene(
  "device",
  "13-device",
  40.5,
  3.5,
  clip(
    0,
    3.5,
    2,
    `<div id="f13" class="line h1" style="top:380px">Your words stay<br>on your device.</div>`,
  ),
  appear("#f13", 0.1, 0.6, "{opacity:0}"),
);

// ---------------------------------------------------------------- 14 offline (44–47)
scene(
  "offline",
  "14-offline",
  44,
  3,
  clip(0, 3, 1, plate("f14-plate", "v2-offline", 1100, 90)) +
    clip(0, 3, 2, `<div id="f14" class="line h2" style="top:800px">Works offline.</div>`),
  appear("#f14-plate", 0, 0.4, "{opacity:0,y:20}") + appear("#f14", 0.5, 0.4, "{opacity:0,y:16}"),
);

// ---------------------------------------------------------------- 15 free (47–51)
scene(
  "free",
  "15-free",
  47,
  4,
  clip(
    0,
    4,
    2,
    `<div class="line display" style="top:330px"><span id="f15-a">Free.</span><br><span id="f15-b" class="acted">Open source.</span></div>`,
  ),
  appear("#f15-a", 0.2, 0.4, "{opacity:0,y:30}") +
    appear("#f15-b", 0.9, 0.45, "{opacity:0,y:30}") +
    leave("#f15-a,#f15-b", 3.6, 0.35, "{opacity:0,y:-40}"),
);

// ---------------------------------------------------------------- 16 browsers (51–54)
scene(
  "browsers",
  "16-browsers",
  51,
  3,
  clip(
    0,
    3,
    2,
    `<div class="line h2" style="top:470px"><span id="f16-a">Chrome</span> <span class="dim" style="color:var(--ink3)">·</span> <span id="f16-b">Firefox</span> <span style="color:var(--ink3)">·</span> <span id="f16-c">Edge</span></div>`,
  ),
  appear("#f16-a", 0.2, 0.3, "{opacity:0}") +
    appear("#f16-b", 0.7, 0.3, "{opacity:0}") +
    appear("#f16-c", 1.2, 0.3, "{opacity:0}"),
);

// ---------------------------------------------------------------- 17 logo (54–60)
{
  const drift = [
    "This message was typed with Tab.",
    "Thanks for the report.",
    "Call me back once you're free.",
    "I received the report. We should have reviewed it on Monday.",
    "Gracias por el informe.",
  ]
    .map(
      (t, n) =>
        `<div class="line typed" style="top:${120 + n * 180}px;opacity:.045;filter:blur(6px)">${t}</div>`,
    )
    .join("");
  const html =
    clip(0, 6, 1, `<div id="f17-drift" style="position:absolute;inset:0">${drift}</div>`) +
    clip(0, 6, 2, line("f17c", [""], "typed", 300).html) +
    clip(
      0,
      6,
      3,
      `<img id="f17-logo" class="logo" src="assets/logo.png" alt="FluentTyper logo" style="left:${(W - 168) / 2}px;top:260px;opacity:0">` +
        `<div id="f17-name" class="line h2" style="top:470px">FluentTyper</div>` +
        `<div id="f17-tag" class="line lead" style="top:600px">Less typing. More you.</div>` +
        `<div id="f17-store" class="line foot" style="top:690px;font-size:28px;color:var(--ink2)">Free for Chrome, Firefox and Edge</div>`,
    );
  const motion =
    `tl.fromTo("#f17-drift",{y:40},{y:-60,duration:6,ease:"none"},0);` +
    caretAt("f17c", -1, 0) +
    `tl.fromTo("#f17c",{x:-420},{x:0,duration:.9,ease:"power3.inOut"},0.1);` +
    `tl.to("#f17c",{opacity:0,duration:.25},1.0);` +
    appear("#f17-logo", 1.0, 0.5, "{opacity:0,scale:.6}") +
    appear("#f17-name", 1.4, 0.45, "{opacity:0,y:20}") +
    appear("#f17-tag", 2.0, 0.45, "{opacity:0,y:16}") +
    appear("#f17-store", 2.6, 0.45, "{opacity:0}");
  scene("logo", "17-logo", 54, 6, html, motion);
}

// ---------------------------------------------------------------- assemble

const total = scenes.reduce((sum, s) => sum + s.d, 0);
if (Math.abs(total - 60) > 1e-6) throw new Error(`Scenes add up to ${total} s, not 60 s`);
// Generated output only: old scene files must not linger.
await rm(resolve(dir, "compositions"), { recursive: true, force: true });
await mkdir(resolve(dir, "compositions/frames"), { recursive: true });
for (const s of scenes) {
  layer = 0;
  const html = s.html.replace(/id="L(\d+)"/g, (_, n) => `id="${s.id}-layer-${n}"`);
  await writeFile(
    resolve(dir, `compositions/frames/${s.file}.html`),
    `<!doctype html><html lang="en"><head><meta charset="utf-8"></head><body><template><style>#${s.id}{position:absolute;inset:0;width:100%;height:100%}</style><div id="${s.id}" data-composition-id="${s.id}" data-width="${W}" data-height="${H}" data-duration="${s.d}"><div id="${s.id}-ground" class="clip" data-start="0" data-duration="${s.d}" data-track-index="0"><div class="ground"></div></div>${html}</div><script>{const tl=gsap.timeline({paused:true});${s.motion}window.__timelines["${s.id}"]=tl;}</script></template></body></html>`,
  );
}
const hosts = scenes
  .map(
    (s) =>
      `<div id="host-${s.id}" class="clip" data-composition-id="${s.id}" data-composition-src="compositions/frames/${s.file}.html" data-start="${s.start}" data-duration="${s.d}" data-width="${W}" data-height="${H}" data-track-index="1" data-track-kind="graphics"></div>`,
  )
  .join("\n");
await mkdir(resolve(dir, "assets/vendor"), { recursive: true });
await writeFile(
  resolve(dir, "assets/logo.png"),
  await readFile(resolve(dir, "../../public/icon/icon256.png")),
);
await writeFile(
  resolve(dir, "assets/vendor/gsap.min.js"),
  await readFile(resolve(dir, "node_modules/gsap/dist/gsap.min.js")),
);
await writeFile(
  resolve(dir, "index.html"),
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=${W},height=${H}"><title>FluentTyper — The text writes the ad</title><script src="assets/vendor/gsap.min.js"></script><style>${CSS}</style></head><body><div id="root" data-composition-id="main" data-start="0" data-duration="60" data-fps="30" data-width="${W}" data-height="${H}">${hosts}<audio id="score-v2" src="assets/audio/original-score-v2.wav" data-start="0" data-duration="60" data-track-index="6" data-volume="1"></audio></div><script>const tl=gsap.timeline({paused:true});window.__timelines["main"]=tl;</script></body></html>`,
);
console.log(`Assembled ${scenes.length} scenes, ${total} s, local assets only.`);
