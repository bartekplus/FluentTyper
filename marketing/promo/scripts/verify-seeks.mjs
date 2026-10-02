// Pinned HyperFrames check path; compare direct forward/backward rendered states.
import { bundleWithLocalizedFonts } from "../node_modules/hyperframes/dist/bundleWithLocalizedFonts-JKJKZR2S.js";
import { serveStaticProjectHtml } from "../node_modules/hyperframes/dist/chunk-AXWBDWAV.js";
import {
  openSettledCompositionPage,
  seekCompositionTimeline,
  AUDIT_SEEK_OPTIONS,
} from "../node_modules/hyperframes/dist/chunk-XZSH5GS7.js";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const dir = resolve(import.meta.dirname, "..");
const html = await bundleWithLocalizedFonts(dir);
const server = await serveStaticProjectHtml(dir, html);
const { browser, page } = await openSettledCompositionPage(html, server.url, {
  browserGpuMode: "software",
  renderReadyTimeoutMs: 10000,
});
const times = [
  0, 0.7, 1.49, 1.51, 3.45, 4.85, 6.4, 8.99, 9.01, 10.79, 10.81, 13.99, 14.01, 15.99, 16.01, 18.99,
  19.01, 23.49, 23.51, 26.99, 27.01, 28.59, 28.61, 32.99, 33.01, 36.99, 37.01, 38.5, 41.9,
];
const baseline = new Map();
const results = [];
const visibleState = () =>
  page.evaluate(() =>
    Array.from(
      document.querySelectorAll(
        "img,h1,p,small,.label,.pointer,.pulse,.progress,.key,.cta-url,.cta-browsers,.cta-qualified",
      ),
    )
      .filter((el) => {
        for (let p = el; p; p = p.parentElement) {
          const s = getComputedStyle(p);
          if (s.display === "none" || s.visibility === "hidden" || Number(s.opacity) === 0)
            return false;
        }
        return true;
      })
      .map((el) => {
        const s = getComputedStyle(el),
          r = el.getBoundingClientRect();
        return {
          id: el.id,
          tag: el.tagName,
          text: el.textContent,
          src: el.getAttribute("src"),
          box: [r.x, r.y, r.width, r.height].map((n) => Math.round(n * 10000) / 10000),
          opacity: s.opacity,
          transform: s.transform,
        };
      }),
  );
try {
  await mkdir(resolve(dir, "renders/qa"), { recursive: true });
  for (const t of times) {
    await seekCompositionTimeline(page, t, AUDIT_SEEK_OPTIONS);
    baseline.set(t, JSON.stringify(await visibleState()));
    await page.screenshot({ path: resolve(dir, "renders/qa/seek-forward-" + t + ".png") });
  }
  for (const t of [...times].reverse()) {
    await seekCompositionTimeline(page, t, AUDIT_SEEK_OPTIONS);
    const actual = JSON.stringify(await visibleState());
    results.push({ time: t, stateEqual: actual === baseline.get(t) });
    await page.screenshot({ path: resolve(dir, "renders/qa/seek-backward-" + t + ".png") });
  }
  await writeFile(
    resolve(dir, "evidence/seeks.json"),
    JSON.stringify(
      {
        times: times.length,
        passed: results.every((r) => r.stateEqual),
        comparison:
          "Exact visible DOM state and geometry; pixel equivalence checked separately to allow subpixel image raster differences.",
        results,
      },
      null,
      2,
    ),
  );
  if (results.some((r) => !r.stateEqual))
    throw new Error(
      "Forward/backward visible state mismatch: " +
        JSON.stringify(results.filter((r) => !r.stateEqual)),
    );
  console.log(
    "PASS: " +
      times.length +
      " direct forward/backward seeks preserve exact visible states and geometry.",
  );
} finally {
  await browser.close();
  await server.close();
}
