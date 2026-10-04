/**
 * Builds promo v2 (STORYBOARD.md v2, 60 s, dark) as HyperFrames HTML from the verified
 * dark captures in assets/ui/ (capture-v2.ts, capture-ai.ts, capture-wordpress.ts).
 *
 *   bun scripts/compose-v2.ts
 *
 * One persistent window holds the product from 4.5 s to 40.5 s: its states cross-fade in
 * place, close-ups are camera zooms into it, and one caption under it says what happened.
 * Writes index.html and compositions/frames/NN-*.html; regeneration overwrites them.
 */
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const dir = resolve(import.meta.dir, "..");
type Box = { x: number; y: number; width: number; height: number };
type Point = { x: number; y: number };
type State = {
  name: string;
  text: string;
  boxes: { popup: Box | null; card: Box | null; panel: Box | null };
};
const evidence = JSON.parse(
  await readFile(resolve(dir, "evidence/interactions-v2.json"), "utf8"),
) as {
  states: State[];
  points: Record<string, Point>;
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

const W = 1920;
const H = 1080;
// The persistent window: a 1200×640 capture shown 1280 wide.
const WIN = { x: 320, y: 140, width: 1280 };
const K = WIN.width / 1200;
const WIN_H = 640 * K;
/** A capture point (CSS px) on screen, inside the window. */
const onScreen = (p: Point): Point => ({ x: WIN.x + p.x * K, y: WIN.y + p.y * K });
const centerOf = (b: Box): Point => onScreen({ x: b.x + b.width / 2, y: b.y + b.height / 2 });

const CSS = `
:root{--stage:#0a0a0c;--lift:#141418;--surface:#1c1c1f;--hair:#2c2c31;--ink:#f5f5f7;--ink2:#a1a1a6;--ink3:#6e6e73;--cyan:#1bd9fd;--blue:#1fa7f3}
*{box-sizing:border-box}html,body{margin:0;width:${W}px;height:${H}px;overflow:hidden;background:var(--stage);color:var(--ink);font-family:system-ui,-apple-system,sans-serif}
#root{position:relative;width:100%;height:100%;overflow:hidden;background:var(--stage)}
.clip{position:absolute;inset:0}
.ground{position:absolute;inset:0;background:radial-gradient(ellipse at 50% 40%,var(--lift) 0%,var(--stage) 72%)}
.line{position:absolute;left:0;right:0;text-align:center;font-weight:600;letter-spacing:-0.02em;line-height:1.15;white-space:pre}
.typed{font-size:69px}.h1{font-size:120px;font-weight:700;letter-spacing:-0.035em;line-height:1.04}.display{font-size:170px;font-weight:800;letter-spacing:-0.045em;line-height:.98}
.lead{font-size:36px;font-weight:500;color:var(--ink2);letter-spacing:-0.01em}
.ch{position:relative;opacity:0}.cr{position:absolute;right:-4px;top:.12em;width:4px;height:.92em;border-radius:2px;background:var(--cyan);display:none}
.c0 .cr{right:auto;left:-6px}
.word[data-acted="1"]{background:linear-gradient(90deg,var(--cyan),var(--blue));-webkit-background-clip:text;background-clip:text;color:transparent}
.cam{position:absolute;inset:0}
.win{position:absolute;left:${WIN.x}px;top:${WIN.y}px;width:${WIN.width}px;height:${WIN_H}px;overflow:hidden;border:1px solid var(--hair);border-radius:18px;background:#1c1c1e;box-shadow:0 50px 140px rgba(0,0,0,.65)}
.win img,.mini img{position:absolute;left:0;top:0;width:100%;display:block}
.mini{position:absolute;overflow:hidden;border:1px solid var(--hair);border-radius:14px;background:#1c1c1e;box-shadow:0 30px 90px rgba(0,0,0,.6)}
.crop{position:absolute;overflow:hidden;border:1px solid var(--hair);border-radius:14px;box-shadow:0 30px 90px rgba(0,0,0,.6)}
.crop img{position:absolute;display:block;max-width:none}
.cap{position:absolute;left:0;right:0;top:${WIN.y + WIN_H + 52}px;text-align:center;font-size:42px;font-weight:600;letter-spacing:-0.015em;color:var(--ink);opacity:0}
.sub{position:absolute;left:0;right:0;text-align:center;font-size:30px;font-weight:500;color:var(--ink2);opacity:0}
.kbd{display:inline-block;padding:4px 16px;margin:0 4px;border-radius:12px;background:var(--surface);border:1px solid var(--hair);font-size:34px;font-weight:600;vertical-align:4px}
.label{position:absolute;text-align:center;font-size:26px;font-weight:600;color:var(--ink2);opacity:0}
.pointer{position:absolute;left:0;top:0;width:40px;height:52px;filter:drop-shadow(0 3px 6px rgba(0,0,0,.7));opacity:0}
.logo{position:absolute;width:168px;height:168px}
`;

// ---------------------------------------------------------------- building blocks

let layer = 0;
const clip = (start: number, duration: number, track: number, inner: string) =>
  `<div id="L${layer++}" class="clip" data-start="${start}" data-duration="${duration}" data-track-index="${track}">${inner}</div>`;
const img = (name: string, alt = `FluentTyper capture: ${name}`) =>
  `src="assets/ui/${name}.png" alt="${alt}"`;

/** The window with its stacked states; the first is visible. */
const windowWith = (id: string, names: string[]) =>
  `<div id="${id}" class="win">${names
    .map((name, n) => `<img id="${id}-${n}" ${img(name)} style="opacity:${n === 0 ? 1 : 0}">`)
    .join("")}</div>`;
/** Cross-fades the window from state `from` to state `to` at `t`. */
const swap = (id: string, from: number, to: number, t: number) =>
  `tl.to("#${id}-${to}",{opacity:1,duration:.3,ease:"power1.out"},${t});tl.set("#${id}-${from}",{opacity:0},${+(t + 0.3).toFixed(2)});`;
/** Camera zoom on a screen point (scale 1 = the whole window). */
const zoom = (sel: string, at: Point, scale: number, t: number, d = 0.8) =>
  `tl.to("${sel}",{scale:${scale},transformOrigin:"${at.x.toFixed(0)}px ${at.y.toFixed(0)}px",duration:${d},ease:"power2.inOut"},${t});`;
const caption = (id: string, html: string) => `<div id="${id}" class="cap">${html}</div>`;
const kbd = (id: string, label: string) => `<span id="${id}" class="kbd">${label}</span>`;
const show = (sel: string, t: number, d = 0.35) =>
  `tl.fromTo("${sel}",{opacity:0,y:10},{opacity:1,y:0,duration:${d},ease:"power2.out",immediateRender:false},${t});`;
const hide = (sel: string, t: number, d = 0.25) =>
  `tl.to("${sel}",{opacity:0,duration:${d},ease:"power1.in"},${t});`;
const press = (id: string, t: number) =>
  `tl.to("#${id}",{scale:.9,duration:.1,ease:"power2.in"},${t - 0.1});tl.to("#${id}",{scale:1,duration:.22,ease:"power2.out"},${t});`;
const pointer = (id: string) =>
  `<svg id="${id}" class="pointer" data-layout-ignore viewBox="0 0 32 42"><path d="M2 2L2 32L10 25L17 39L23 36L16 23L28 23Z" fill="#f5f5f7" stroke="#0a0a0c" stroke-width="2"/></svg>`;
/** Moves the pointer to `to` (tip at the point) and clicks at the end. */
const pointTo = (id: string, from: Point, to: Point, t: number, d = 0.7) =>
  `tl.fromTo("#${id}",{x:${from.x},y:${from.y},opacity:0},{x:${to.x - 4},y:${to.y - 3},opacity:1,duration:${d},ease:"power2.out",immediateRender:false},${t});` +
  `tl.to("#${id}",{scale:.86,duration:.08},${+(t + d + 0.1).toFixed(2)});tl.to("#${id}",{scale:1,duration:.15},${+(t + d + 0.2).toFixed(2)});`;

/** A typed line: laid out whole but hidden, so it never jumps while it grows. */
function line(id: string, parts: Array<string | { word: string }>, cls: string, top: number) {
  let i = 0;
  const chars = (text: string) =>
    [...text]
      .map((c) => `<span id="${id}-c${i++}" class="ch">${c}<i class="cr"></i></span>`)
      .join("");
  const body = parts
    .map((part, n) =>
      typeof part === "string"
        ? chars(part)
        : `<span id="${id}-w${n}" class="word">${chars(part.word)}</span>`,
    )
    .join("");
  return {
    html: `<div id="${id}" class="line ${cls}" style="top:${top}px"><span id="${id}-c-1" class="ch c0"><i class="cr"></i></span>${body}</div>`,
    length: i,
  };
}
function typeOn(id: string, from: number, to: number, t0: number, step: number): string {
  let out = "";
  for (let i = from; i < to; i++) {
    const t = +(t0 + (i - from) * step).toFixed(3);
    out += `tl.set("#${id}-c${i}",{opacity:1},${t});tl.set("#${id}-c${i} .cr",{display:"block"},${t});tl.set("#${id}-c${i - 1} .cr",{display:"none"},${t});`;
  }
  return out;
}
const caretAt = (id: string, i: number, t: number) =>
  `tl.set("#${id}-c${i} .cr",{display:"block"},${t});`;
function blink(id: string, i: number, from: number, to: number): string {
  let out = "";
  for (let t = from, on = false; t < to; t += 0.53, on = !on)
    out += `tl.set("#${id}-c${i} .cr",{opacity:${on ? 1 : 0}},${t.toFixed(2)});`;
  return out;
}

type Scene = { id: string; file: string; start: number; d: number; html: string; motion: string };
const scenes: Scene[] = [];
let clock = 0;
const scene = (id: string, d: number, html: string, motion: string) => {
  scenes.push({
    id,
    file: `${String(scenes.length + 1).padStart(2, "0")}-${id}`,
    start: clock,
    d,
    html,
    motion,
  });
  clock = +(clock + d).toFixed(2);
};

// ---------------------------------------------------------------- 01 caret (0–2)
{
  const l = line("f1", [""], "typed", 470);
  scene("caret", 2, clip(0, 2, 2, l.html), caretAt("f1", -1, 0) + blink("f1", -1, 0.4, 2));
}

// ---------------------------------------------------------------- 02 typed with Tab (2–4.5)
{
  if (state("v2-open-done").text !== "This message was typed with Tab.")
    throw new Error("Opening text changed");
  const l = line("f2", ["This ", { word: "message" }, " was typed with Tab."], "typed", 440);
  const p = box("v2-open-popup", "popup");
  const r: Box = { x: p.x - 6, y: p.y - 6, width: p.width + 12, height: p.height + 12 };
  const k = 2;
  const popup = `<div id="f2-popup" class="crop" style="left:760px;top:540px;width:${r.width * k}px;height:${r.height * k}px;opacity:0"><img ${img("v2-open-popup")} style="width:${1200 * k}px;left:${-r.x * k}px;top:${-r.y * k}px"></div>`;
  const motion =
    caretAt("f2", -1, 0) +
    typeOn("f2", 0, 8, 0.05, 0.1) +
    show("#f2-popup", 0.85, 0.2) +
    hide("#f2-popup", 1.45, 0.1) +
    typeOn("f2", 8, 12, 1.5, 0.02) +
    `tl.set("#f2-w1",{attr:{"data-acted":"1"}},1.5);` +
    typeOn("f2", 12, l.length, 1.6, 0.03) +
    `tl.to("#f2",{opacity:0,y:-30,duration:.35,ease:"power2.in"},2.15);`;
  scene("typed", 2.5, clip(0, 2.5, 2, l.html) + clip(0, 2.5, 3, popup), motion);
}

// ---------------------------------------------------------------- 03 completion (4.5–10.5)
{
  const states = ["v2-popup", "v2-popup-accepted", "v2-inline", "v2-inline-accepted"];
  const popupAt = centerOf(box("v2-popup", "popup"));
  // The second line of the inline shot: "I'll review it tod" + "ay".
  const inlineAt = onScreen({ x: 230, y: 250 });
  const html =
    clip(0, 6, 1, `<div id="f3-cam" class="cam">${windowWith("f3", states)}</div>`) +
    clip(
      0,
      6,
      3,
      caption("f3-a", `Press ${kbd("f3-tab1", "Tab")} to finish the word.`) +
        caption("f3-b", `Or accept the ending right in the line ${kbd("f3-tab2", "Tab")}`),
    );
  const motion =
    `tl.fromTo("#f3",{opacity:0,y:40},{opacity:1,y:0,duration:.55,ease:"power3.out"},0);` +
    show("#f3-a", 0.4) +
    zoom("#f3-cam", popupAt, 1.45, 0.55) +
    press("f3-tab1", 1.6) +
    swap("f3", 0, 1, 1.6) +
    hide("#f3-a", 2.8) +
    zoom("#f3-cam", inlineAt, 1.45, 2.85, 0.6) +
    swap("f3", 1, 2, 3.0) +
    show("#f3-b", 3.05) +
    press("f3-tab2", 4.6) +
    swap("f3", 2, 3, 4.6) +
    zoom("#f3-cam", inlineAt, 1, 5.2, 0.7);
  scene("completion", 6, html, motion);
}

// ---------------------------------------------------------------- 04 saved reply (10.5–14)
{
  const html =
    clip(
      0,
      3.5,
      1,
      `<div id="f4-cam" class="cam">${windowWith("f4", ["v2-inline-accepted", "v2-snippet", "v2-snippet-expanded"])}</div>`,
    ) +
    clip(
      0,
      3.5,
      3,
      caption("f4-a", `Type a shortcut. ${kbd("f4-tab", "Tab")} Get the whole reply.`),
    );
  const snippetAt = centerOf(box("v2-snippet", "popup"));
  const motion =
    swap("f4", 0, 1, 0.05) +
    show("#f4-a", 0.2) +
    zoom("#f4-cam", snippetAt, 1.4, 0.3, 0.7) +
    press("f4-tab", 1.7) +
    swap("f4", 1, 2, 1.7) +
    zoom("#f4-cam", snippetAt, 1, 2.7, 0.7);
  scene("reply", 3.5, html, motion);
}

// ---------------------------------------------------------------- 05 Review (14–25)
{
  const names = [
    "v2-snippet-expanded",
    "v2-review-highlights",
    "v2-review-card",
    "v2-review-one-fixed",
    "v2-review-safe-fixed",
    "v2-style-card",
  ];
  const card = centerOf(box("v2-review-card", "card"));
  const apply = onScreen(evidence.points.apply);
  const fixAll = onScreen(evidence.points.fixAll);
  const styleCard = centerOf(box("v2-style-card", "card"));
  // Zoomed 1.8 on the card: the Apply point moves away from the zoom center.
  const zoomed = (p: Point, at: Point, s: number): Point => ({
    x: at.x + (p.x - at.x) * s,
    y: at.y + (p.y - at.y) * s,
  });
  const applyZoomed = zoomed(apply, card, 1.8);
  const html =
    clip(
      0,
      11,
      1,
      `<div id="f5-cam" class="cam">${windowWith("f5", names)}${pointer("f5-ptr")}</div>`,
    ) +
    clip(
      0,
      11,
      3,
      caption("f5-a", `Press ${kbd("f5-key", "Alt + Shift + R")} Review finds what you missed.`) +
        caption("f5-b", "Check each fix before you apply it.") +
        caption("f5-c", "Or apply every safe fix at once.") +
        caption("f5-d", "Style advice, when you want it."),
    );
  const motion =
    swap("f5", 0, 1, 0.5) +
    show("#f5-a", 0.15) +
    press("f5-key", 0.45) +
    hide("#f5-a", 2.25) +
    zoom("#f5-cam", card, 1.8, 2.4) +
    swap("f5", 1, 2, 2.5) +
    show("#f5-b", 2.6) +
    pointTo("f5-ptr", { x: applyZoomed.x + 200, y: applyZoomed.y + 150 }, apply, 3.2) +
    swap("f5", 2, 3, 4.15) +
    hide("#f5-ptr", 4.35, 0.2) +
    hide("#f5-b", 4.6) +
    zoom("#f5-cam", card, 1, 4.6) +
    show("#f5-c", 5.3) +
    pointTo("f5-ptr", { x: fixAll.x - 260, y: fixAll.y - 140 }, fixAll, 5.6) +
    swap("f5", 3, 4, 6.55) +
    hide("#f5-ptr", 6.8, 0.2) +
    hide("#f5-c", 7.8) +
    swap("f5", 4, 5, 8.0) +
    show("#f5-d", 8.1) +
    zoom("#f5-cam", styleCard, 1.45, 8.2) +
    zoom("#f5-cam", styleCard, 1, 10.1, 0.8);
  scene("review", 11, html, motion);
}

// ---------------------------------------------------------------- 06 languages (25–30)
{
  const langs = ["es", "de", "pl", "el", "ar"];
  for (const code of langs) state(`v2-lang-${code}`);
  const html =
    clip(
      0,
      5,
      1,
      `<div class="cam">${windowWith("f6", ["v2-style-card", ...langs.map((c) => `v2-lang-${c}`)])}</div>`,
    ) + clip(0, 5, 3, caption("f6-a", "Works in 10 languages."));
  const motion =
    langs.map((_, n) => swap("f6", n, n + 1, +(0.1 + n * 0.9).toFixed(2))).join("") +
    show("#f6-a", 0.25);
  scene("languages", 5, html, motion);
}

// ---------------------------------------------------------------- 07 everywhere (30–35.5)
{
  const mini = 560;
  const s = mini / WIN.width;
  const y = 300;
  const xs = [100, 680, 1260];
  const miniH = WIN_H * s;
  const others: Array<[string, string]> = [
    ["v2-editor-wordpress", "WordPress"],
    ["v2-editor-notes", "Notes"],
  ];
  const html =
    clip(
      0,
      5.5,
      1,
      `<div class="cam">${windowWith("f7", ["v2-lang-ar", "v2-popup"])}${others
        .map(
          ([name], n) =>
            `<div id="f7-m${n}" class="mini" style="left:${xs[n + 1]}px;top:${y}px;width:${mini}px;height:${miniH}px;opacity:0"><img ${img(name)}></div>`,
        )
        .join("")}</div>`,
    ) +
    clip(
      0,
      5.5,
      3,
      ["Mail", ...others.map(([, label]) => label)]
        .map(
          (label, n) =>
            `<div id="f7-l${n}" class="label" style="left:${xs[n]}px;width:${mini}px;top:${y + miniH + 24}px">${label}</div>`,
        )
        .join("") +
        `<div id="f7-a" class="cap" style="top:${y + miniH + 120}px">Works where you write.</div>` +
        `<div id="f7-b" class="sub" style="top:${y + miniH + 186}px">Mail, WordPress, Google Docs and more.</div>`,
    );
  const motion =
    swap("f7", 0, 1, 0.05) +
    `tl.to("#f7",{x:${xs[0] - WIN.x},y:${y - WIN.y},scale:${s},transformOrigin:"0 0",duration:.8,ease:"power3.inOut"},0.45);` +
    `tl.fromTo("#f7-m0",{opacity:0,x:120},{opacity:1,x:0,duration:.6,ease:"power3.out",immediateRender:false},0.9);` +
    `tl.fromTo("#f7-m1",{opacity:0,x:120},{opacity:1,x:0,duration:.6,ease:"power3.out",immediateRender:false},1.2);` +
    show("#f7-l0,#f7-l1,#f7-l2", 1.6, 0.4) +
    show("#f7-a", 1.9) +
    show("#f7-b", 2.3) +
    hide("#f7-m0,#f7-m1,#f7-l0,#f7-l1,#f7-l2,#f7-a,#f7-b", 4.6, 0.3) +
    `tl.to("#f7",{x:0,y:0,scale:1,duration:.6,ease:"power3.inOut"},4.85);`;
  scene("everywhere", 5.5, html, motion);
}

// ---------------------------------------------------------------- 08 Local AI (35.5–40.5)
{
  const panel: Point = onScreen({ x: 1018, y: 230 });
  const html =
    clip(
      0,
      5,
      1,
      `<div id="f8-cam" class="cam">${windowWith("f8", ["v2-popup", "v2-ai-before", "v2-ai-rewrite"])}</div>`,
    ) +
    clip(
      0,
      5,
      3,
      caption("f8-a", "Rewrite a draft with optional Local AI.") +
        `<div id="f8-b" class="sub" style="top:${WIN.y + WIN_H + 116}px">Chrome and Edge. Runs on your device.</div>`,
    );
  const motion =
    swap("f8", 0, 1, 0.05) +
    show("#f8-a", 0.25) +
    swap("f8", 1, 2, 1.2) +
    show("#f8-b", 1.4) +
    zoom("#f8-cam", panel, 1.55, 1.4, 0.9) +
    `tl.to("#f8-cam",{opacity:0,duration:.4,ease:"power1.in"},4.55);` +
    hide("#f8-a,#f8-b", 4.5, 0.4);
  scene("localai", 5, html, motion);
}

// ---------------------------------------------------------------- 09 your device (40.5–47)
// The privacy promise holds; one quiet line adds the offline proof (README).
scene(
  "device",
  6.5,
  clip(
    0,
    6.5,
    2,
    `<div id="f9" class="line h1" style="top:340px;opacity:0">Your words stay<br>on your device.</div>` +
      `<div id="f9-b" class="line lead" style="top:640px;opacity:0">Nothing is uploaded. It works offline, too.</div>`,
  ),
  show("#f9", 0.15, 0.6) + show("#f9-b", 2.6, 0.6),
);

// ---------------------------------------------------------------- 11 free (47–51)
scene(
  "free",
  4,
  clip(
    0,
    4,
    2,
    `<div class="line display" style="top:340px"><span id="f11-a" style="opacity:0">Free.</span><br><span id="f11-b" style="opacity:0">Open source.</span></div>`,
  ),
  show("#f11-a", 0.2, 0.4) + show("#f11-b", 0.9, 0.45) + hide("#f11-a,#f11-b", 3.6, 0.35),
);

// ---------------------------------------------------------------- 12 browsers (51–54)
scene(
  "browsers",
  3,
  clip(
    0,
    3,
    2,
    `<div class="line h1" style="top:430px"><span id="f12-a" style="opacity:0">Chrome.</span> <span id="f12-b" style="opacity:0">Firefox.</span> <span id="f12-c" style="opacity:0">Edge.</span></div>`,
  ),
  show("#f12-a", 0.2, 0.3) + show("#f12-b", 0.7, 0.3) + show("#f12-c", 1.2, 0.3),
);

// ---------------------------------------------------------------- 13 logo (54–60)
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
    clip(0, 6, 1, `<div id="f13-drift" style="position:absolute;inset:0">${drift}</div>`) +
    clip(0, 6, 2, line("f13c", [""], "typed", 300).html) +
    clip(
      0,
      6,
      3,
      `<img id="f13-logo" class="logo" src="assets/logo.png" alt="FluentTyper logo" style="left:${(W - 168) / 2}px;top:260px;opacity:0">` +
        `<div id="f13-name" class="line h1" style="top:460px;font-size:96px;opacity:0">FluentTyper</div>` +
        `<div id="f13-tag" class="line lead" style="top:600px;opacity:0">Less typing. More you.</div>` +
        `<div id="f13-store" class="line" style="top:690px;font-size:28px;font-weight:500;color:var(--ink2);opacity:0">Free for Chrome, Firefox and Edge</div>`,
    );
  const motion =
    `tl.fromTo("#f13-drift",{y:40},{y:-60,duration:6,ease:"none"},0);` +
    caretAt("f13c", -1, 0) +
    `tl.fromTo("#f13c",{x:-420},{x:0,duration:.9,ease:"power3.inOut"},0.1);` +
    `tl.to("#f13c",{opacity:0,duration:.25},1.0);` +
    `tl.fromTo("#f13-logo",{opacity:0,scale:.6},{opacity:1,scale:1,duration:.5,ease:"power3.out",immediateRender:false},1.0);` +
    show("#f13-name", 1.4, 0.45) +
    show("#f13-tag", 2.0, 0.45) +
    show("#f13-store", 2.6, 0.45);
  scene("logo", 6, html, motion);
}

// ---------------------------------------------------------------- assemble

const total = scenes.reduce((sum, s) => sum + s.d, 0);
if (Math.abs(total - 60) > 1e-6) throw new Error(`Scenes add up to ${total} s, not 60 s`);
// Generated output only: old scene files must not linger.
await rm(resolve(dir, "compositions"), { recursive: true, force: true });
await mkdir(resolve(dir, "compositions/frames"), { recursive: true });
for (const s of scenes) {
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
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=${W},height=${H}"><title>FluentTyper</title><script src="assets/vendor/gsap.min.js"></script><style>${CSS}</style></head><body><div id="root" data-composition-id="main" data-start="0" data-duration="60" data-fps="30" data-width="${W}" data-height="${H}">${hosts}<audio id="score-v2" src="assets/audio/original-score-v2.wav" data-start="0" data-duration="60" data-track-index="6" data-volume="1"></audio></div><script>const tl=gsap.timeline({paused:true});window.__timelines["main"]=tl;</script></body></html>`,
);
console.log(`Assembled ${scenes.length} scenes, ${total} s, local assets only.`);
