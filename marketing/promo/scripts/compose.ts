/** Build editable scene HTML and its HyperFrames assembly from verified local plates. */
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";
const dir = resolve(import.meta.dir, "..");
const evidence = JSON.parse(await readFile(resolve(dir, "evidence/interactions.json"), "utf8"));
const X = 96,
  Y = 218,
  S = 1.728;
const point = (p: { x: number; y: number }) => ({ x: X + p.x * S, y: Y + p.y * S });
const launcher = point(evidence.launcher),
  mark = point(evidence.highlightClick),
  apply = point(evidence.apply),
  fixAll = point(evidence.fixAll);
const css = `:root{--ink:#0f172a;--muted:#475569;--accent:#4f46e5;--paper:#f6f5fb}*{box-sizing:border-box}html,body{margin:0;width:1920px;height:1080px;overflow:hidden;background:var(--paper);font-family:system-ui,sans-serif;color:var(--ink)}#root{position:relative;width:100%;height:100%;overflow:hidden}.clip{position:absolute;inset:0}.ground{position:absolute;inset:0;background:var(--paper)}.brand{position:absolute;left:96px;top:35px;display:flex;align-items:center;gap:14px;font-size:28px;font-weight:650;letter-spacing:-.7px}.brand img{width:48px;height:48px}.headline{position:absolute;left:96px;top:110px;font-size:68px;line-height:1.05;letter-spacing:-2.8px;font-weight:650;margin:0;max-width:1730px}.plate{position:absolute;left:96px;top:218px;width:1728px;height:829.44px}.plate img{display:block;width:100%;height:100%;object-fit:contain}.note{position:absolute;left:1265px;top:460px;width:510px;color:var(--ink)}.note .eyebrow{font-size:26px;color:var(--accent);font-weight:600;margin:0 0 24px}.note p{font-size:34px;line-height:1.3;margin:0 0 24px}.key{width:180px;height:120px;border:3px solid #cbd5e1;border-bottom-width:9px;border-radius:18px;background:#fff;display:grid;place-items:center;font-size:58px;font-weight:500;margin-bottom:28px}.note small{font-size:25px;color:var(--muted)}.pointer{position:absolute;left:0;top:0;width:40px;height:52px;filter:drop-shadow(0 2px 3px #0f172a55);pointer-events:none;z-index:20}.pulse{opacity:0;position:absolute;left:-27px;top:-27px;width:54px;height:54px;border-radius:50%;border:3px solid var(--accent);pointer-events:none;z-index:19}.progress{position:absolute;bottom:0;left:0;height:6px;width:100%;background:var(--accent);transform-origin:0 50%;z-index:40}.footnote{font-size:22px;color:var(--muted)}.cta-body{position:absolute;left:96px;top:206px;width:1728px;display:flex;flex-direction:column;align-items:center;gap:28px}.cta-logo{width:126px;height:126px}.cta-title{font-size:76px;line-height:1.13;letter-spacing:-3px;font-weight:650;text-align:center;margin:0;max-width:1650px}.cta-button{font-size:42px;font-weight:600;background:var(--accent);color:#fff;padding:23px 52px;border-radius:60px;margin-top:8px}.cta-url{font-size:36px;font-weight:500;margin-top:6px}.cta-browsers{font-size:30px;color:var(--muted);margin-top:8px}.cta-qualified{font-size:23px;color:var(--muted);margin-top:10px}.privacy-mark{width:106px;height:92px;margin-bottom:28px;color:var(--accent)}.privacy-copy{font-size:38px!important;font-weight:500}.side-rule{width:88px;height:4px;background:var(--accent);margin:0 0 28px}.step{position:absolute;right:96px;top:47px;font-size:22px;color:var(--muted)}`;
const cursor = (id: string) =>
  `<svg id="${id}-pointer" class="pointer" data-layout-ignore viewBox="0 0 32 42"><path d="M2 2L2 32L10 25L17 39L23 36L16 23L28 23Z" fill="#0f172a" stroke="white" stroke-width="2"/></svg><div id="${id}-pulse" class="pulse" data-layout-ignore></div>`;
const plate = (id: string, name: string, start: number, duration: number) =>
  `<div id="${id}" class="clip" data-start="${start}" data-duration="${duration}" data-track-index="1"><div class="plate"><img src="assets/ui/${name}.png" alt="Verified native FluentTyper state: ${name}"></div></div>`;
const header = (id: string, title: string, duration: number) =>
  `<div class="clip" data-start="0" data-duration="${duration}" data-track-index="3"><h1 id="${id}-headline" class="headline">${title}</h1></div>`;
const note = (id: string, markup: string, start: number, duration: number) =>
  `<div class="clip" data-start="${start}" data-duration="${duration}" data-track-index="4"><div id="${id}" class="note">${markup}</div></div>`;
const scenes = [
  {
    id: "writing",
    file: "01-writing",
    start: 0,
    d: 9,
    html:
      plate("writing-p0", "01-autocomplete", 0, 1.5) +
      plate("writing-p1", "02-autocomplete-accepted", 1.5, 1.9) +
      Array.from({ length: 23 }, (_, i) =>
        plate(
          "writing-type-" + i,
          "typing-" + String(i).padStart(2, "0"),
          3.4 + i * 0.13,
          i === 22 ? 2.74 : 0.13,
        ),
      ).join("") +
      header("hook", "Less typing. Fewer mistakes.", 3) +
      `<div class="clip" data-start="3" data-duration="6" data-track-index="3"><h1 class="headline">Keep your writing moving.</h1></div>` +
      note(
        "writing-note",
        '<p class="eyebrow">Predictive autocomplete</p><div id="writing-key" class="key">Tab</div><p>Accept. Keep going.</p>',
        0,
        9,
      ),
    motion: `tl.fromTo("#writing-key",{scale:1},{scale:.91,duration:.12,ease:"power2.in"},1.36);tl.to("#writing-key",{scale:1,duration:.22,ease:"power2.out"},1.5);`,
  },
  {
    id: "expansion",
    file: "02-expansion",
    start: 9,
    d: 5,
    html:
      plate("expansion-p0", "03-snippet", 0, 1.8) +
      plate("expansion-p1", "04-snippet-expanded", 1.8, 3.2) +
      header("expansion", "Stop retyping the same replies.", 5) +
      note(
        "expansion-note",
        '<p class="eyebrow">Your saved reply</p><div id="expansion-key" class="key">Tab</div><p>One shortcut. Your words.</p>',
        0,
        5,
      ),
    motion: `tl.fromTo("#expansion-key",{scale:1},{scale:.91,duration:.12,ease:"power2.in"},1.66);tl.to("#expansion-key",{scale:1,duration:.22,ease:"power2.out"},1.8);`,
  },
  {
    id: "review",
    file: "03-review",
    start: 14,
    d: 13,
    html:
      plate("review-p0", "05-review-before", 0, 2) +
      plate("review-p1", "06-review-highlights", 2, 3) +
      plate("review-p2", "07-review-card", 5, 4.5) +
      plate("review-p3", "08-review-one-fixed", 9.5, 3.5) +
      header("review", "Catch mistakes. Stay in control.", 13) +
      `<div class="clip" data-start="0" data-duration="13" data-track-index="4">${cursor("review")}</div>`,
    motion: `tl.fromTo("#review-pointer",{x:${launcher.x + 80},y:${launcher.y + 50},opacity:0},{x:${launcher.x},y:${launcher.y},opacity:1,duration:.65,ease:"power2.out"},.8);tl.to("#review-pointer",{x:${mark.x},y:${mark.y},duration:.85,ease:"power2.inOut"},3.65);tl.to("#review-pointer",{x:${apply.x},y:${apply.y},duration:.8,ease:"power2.inOut"},8.25);tl.to("#review-pointer",{opacity:0,duration:.2},10.1);${pulses(
      "review",
      [
        { t: 1.88, p: launcher },
        { t: 4.88, p: mark },
        { t: 9.38, p: apply },
      ],
    )}`,
  },
  {
    id: "safe",
    file: "04-safe",
    start: 27,
    d: 6,
    html:
      plate("safe-p0", "08-review-one-fixed", 0, 1.6) +
      plate("safe-p1", "09-review-safe-fixed", 1.6, 4.4) +
      header("safe", "One fix. Or all the safe ones.", 6) +
      `<div class="clip" data-start="0" data-duration="6" data-track-index="4">${cursor("safe")}</div>`,
    motion: `tl.fromTo("#safe-pointer",{x:${fixAll.x - 120},y:${fixAll.y - 30},opacity:0},{x:${fixAll.x},y:${fixAll.y},opacity:1,duration:.65,ease:"power2.out"},.6);tl.to("#safe-pointer",{opacity:0,duration:.18},2);${pulses("safe", [{ t: 1.48, p: fixAll }])}`,
  },
  {
    id: "private",
    file: "05-private",
    start: 33,
    d: 4,
    html:
      plate("private-p0", "12-clean-final", 0, 4) +
      header("private", "Your words stay yours.", 4) +
      note(
        "private-note",
        `<svg class="privacy-mark" viewBox="0 0 106 92" aria-hidden="true"><rect x="5" y="5" width="96" height="62" rx="7" fill="none" stroke="currentColor" stroke-width="4"/><path d="M38 85H68M53 68V84M34 35L47 48L74 23" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round"/></svg><p class="privacy-copy">FluentTyper doesn’t upload your text.</p><small>Native checks run locally.</small>`,
        0,
        4,
      ),
    motion: `tl.fromTo("#private-note",{y:18,opacity:0},{y:0,opacity:1,duration:.45,ease:"power2.out"},.15);`,
  },
  {
    id: "cta",
    file: "06-cta",
    start: 37,
    d: 5,
    html: `<div class="clip" data-start="0" data-duration="5" data-track-index="3"><div class="cta-body"><img class="cta-logo" src="assets/logo.png" alt="FluentTyper official logo"><h1 id="cta-title" class="cta-title">Write faster.<br class="display-break">Review with confidence.</h1><div id="cta-button" class="cta-button">Get FluentTyper</div><div id="cta-url" class="cta-url">github.com/bartekplus/FluentTyper</div><div id="cta-browsers" class="cta-browsers">Chrome · Firefox · Edge</div><div id="cta-qualified" class="cta-qualified">Review demo: development build · store versions may vary</div></div></div>`,
    motion: `tl.fromTo("#cta-title",{y:18,opacity:0},{y:0,opacity:1,duration:.4,ease:"power2.out"},0);tl.fromTo("#cta-button",{scale:.96,opacity:0},{scale:1,opacity:1,duration:.4,ease:"power3.out"},.15);tl.fromTo("#cta-url,#cta-browsers,#cta-qualified",{opacity:0},{opacity:1,duration:.35,stagger:.05},.35);`,
  },
];
function pulses(id: string, arr: { t: number; p: { x: number; y: number } }[]) {
  return arr
    .map(
      ({ t, p }) =>
        `tl.set("#${id}-pulse",{x:${p.x},y:${p.y},scale:.5,opacity:0},${t});tl.to("#${id}-pulse",{opacity:.65,scale:1,duration:.12},${t});tl.to("#${id}-pulse",{opacity:0,scale:1.5,duration:.25},${t + 0.12});`,
    )
    .join("");
}
await mkdir(resolve(dir, "compositions/frames"), { recursive: true });
for (const scene of scenes) {
  await writeFile(
    resolve(dir, `compositions/frames/${scene.file}.html`),
    `<!doctype html><html lang="en"><head><meta charset="utf-8"></head><body><template><style>#${scene.id}{position:absolute;inset:0;width:100%;height:100%}</style><div id="${scene.id}" data-composition-id="${scene.id}" data-width="1920" data-height="1080" data-duration="${scene.d}"><div class="clip" data-start="0" data-duration="${scene.d}" data-track-index="0"><div class="ground"></div></div>${scene.html}</div><script>{const tl=gsap.timeline({paused:true});${scene.motion}window.__timelines["${scene.id}"]=tl;}</script></template></body></html>`,
  );
}
const hosts = scenes
  .map(
    (sc) =>
      `<div id="host-${sc.id}" class="clip" data-composition-id="${sc.id}" data-composition-src="compositions/frames/${sc.file}.html" data-start="${sc.start}" data-duration="${sc.d}" data-width="1920" data-height="1080" data-track-index="1"></div>`,
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
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=1920,height=1080"><title>FluentTyper — Write faster. Review with confidence.</title><script src="assets/vendor/gsap.min.js"></script><style>${css}</style></head><body><div id="root" data-composition-id="main" data-start="0" data-duration="42" data-fps="30" data-width="1920" data-height="1080">${hosts}<div class="clip" data-start="0" data-duration="42" data-track-index="5"><div class="brand"><img src="assets/logo.png" alt="">FluentTyper</div><div id="progress" class="progress" data-layout-ignore></div></div><audio id="original-score" src="assets/audio/original-score.wav" data-start="0" data-duration="42" data-track-index="6" data-volume="1"></audio></div><script>const tl=gsap.timeline({paused:true});tl.fromTo("#progress",{scaleX:0},{scaleX:1,duration:42,ease:"none"},0);window.__timelines["main"]=tl;</script></body></html>`,
);
// Give every timed element a stable Studio edit target.
for (const scene of scenes) {
  const path = resolve(dir, `compositions/frames/${scene.file}.html`);
  let html = await readFile(path, "utf8");
  let n = 0;
  html = html.replace(
    /<div class="clip"/g,
    () => `<div id="${scene.id}-layer-${n++}" class="clip"`,
  );
  await writeFile(path, html);
}
let index = await readFile(resolve(dir, "index.html"), "utf8");
const brand =
  /<div class="clip" data-start="0" data-duration="42" data-track-index="5">([\s\S]*?)<\/div><audio/.exec(
    index,
  )!;
await writeFile(
  resolve(dir, "compositions/identity.html"),
  `<!doctype html><html><body><template><style>#identity{position:absolute;inset:0;width:100%;height:100%}</style><div id="identity" data-composition-id="identity" data-duration="42" data-width="1920" data-height="1080"><div id="brand-layer" class="clip" data-start="0" data-duration="42" data-track-index="5">${brand[1]}</div></div><script>{const tl=gsap.timeline({paused:true});tl.fromTo("#progress",{scaleX:0},{scaleX:1,duration:42,ease:"none"},0);window.__timelines["identity"]=tl;}</script></template></body></html>`,
);
index = index.replace(
  brand[0],
  '<div id="host-identity" class="clip" data-composition-id="identity" data-composition-src="compositions/identity.html" data-start="0" data-duration="42" data-width="1920" data-height="1080" data-track-index="5"></div><audio',
);
index = index.replace(
  'tl.fromTo("#progress",{scaleX:0},{scaleX:1,duration:42,ease:"none"},0);',
  "",
);
await writeFile(resolve(dir, "index.html"), index);
console.log("Assembled six editable native-UI scenes, 42s, local assets only.");

// Stable Studio IDs are generated together with each composition.
for (const file of [
  "index.html",
  "compositions/identity.html",
  ...scenes.map((scene) => `compositions/frames/${scene.file}.html`),
]) {
  const path = resolve(dir, file);
  let id = 0;
  const prefix = file.replaceAll(/[^a-z0-9]/g, "-");
  const html = (await readFile(path, "utf8")).replace(
    /<(div|img|h1|p|small|svg|path|rect|br|audio)(?=[\s>])/g,
    (tag) => `${tag} data-hf-id="${prefix}-${id++}"`,
  );
  await writeFile(path, html);
}
