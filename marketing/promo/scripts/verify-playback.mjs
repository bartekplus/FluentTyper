import puppeteer from "puppeteer";
import { assertCompletePlayback } from "./playback-validation.mjs";
import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
const dir = resolve(import.meta.dirname, "..");
const movie = await readFile(resolve(dir, "renders/fluenttyper-promo-1080p.mp4"));
const server = createServer((req, res) => {
  if (req.url === "/movie.mp4") {
    res.writeHead(200, { "Content-Type": "video/mp4", "Content-Length": movie.length });
    res.end(movie);
  } else {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(
      '<html><body style="margin:0;background:#f6f5fb"><video id="video" src="/movie.mp4" width="960" height="540" playsinline></video></body></html>',
    );
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const browser = await puppeteer.launch({
  headless: true,
  args: ["--autoplay-policy=no-user-gesture-required"],
});
const results = [];
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 960, height: 540 });
  await mkdir(resolve(dir, "renders/qa"), { recursive: true });
  for (const muted of [false, true]) {
    // A fresh video element keeps frame counters independent of the previous run.
    await page.goto("http://127.0.0.1:" + server.address().port);
    await page.waitForFunction(() => document.querySelector("video").readyState >= 3);
    await page.evaluate(async (muted) => {
      const v = document.querySelector("video");
      v.currentTime = 0;
      v.muted = muted;
      window.playbackDone = new Promise((resolve, reject) => {
        v.onended = () =>
          resolve({
            muted: v.muted,
            currentTime: v.currentTime,
            duration: v.duration,
            decoded: v.webkitDecodedFrameCount,
            dropped: v.getVideoPlaybackQuality().droppedVideoFrames,
            videoFrames: v.getVideoPlaybackQuality().totalVideoFrames,
            readyState: v.readyState,
            error: v.error?.message ?? null,
          });
        v.onerror = () => reject(new Error(v.error?.message ?? "video error"));
      });
      await v.play();
    }, muted);
    for (const t of [1, 5, 10, 15, 20, 25, 30, 35, 40]) {
      await page.waitForFunction(
        (t) => document.querySelector("video").currentTime >= t,
        { timeout: 50000 },
        t,
      );
      await page.screenshot({
        path: resolve(dir, "renders/qa/playback-" + (muted ? "muted" : "audio") + "-" + t + ".png"),
      });
    }
    const result = await page.evaluate(() => window.playbackDone);
    results.push(result);
    console.log(JSON.stringify(result));
  }
  await writeFile(
    resolve(dir, "evidence/playback.json"),
    JSON.stringify({ normalSpeed: true, viewport: "960x540", results }, null, 2),
  );
  for (const result of results) assertCompletePlayback(result);
} finally {
  await browser.close();
  server.close();
}
