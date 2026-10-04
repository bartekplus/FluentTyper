/**
 * Chrome Web Store images from the current composition (run after `bun run assemble`).
 *
 *   bun run store-images
 *
 * Writes renders/store/: 12 screenshots at 1280×800 (the store's 16:10 size), the marquee
 * (1400×560) and the small promo tile (440×280). PNG, RGB, no transparency. Frames come
 * lossless from `hyperframes snapshot`; ffmpeg (a HyperFrames requirement) crops and scales.
 * The film is 16:9: a screenshot keeps the full height and trims the sides.
 */
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const dir = resolve(import.meta.dir, "..");
const out = resolve(dir, "renders/store");
// Seconds into the film. `left` keeps the left edge: that frame is zoomed in on the left.
const SHOTS: Array<{ at: number; name: string; left?: true }> = [
  { at: 6.0, name: "01-tab-completion" },
  { at: 8.95, name: "02-inline-ending" },
  { at: 12.1, name: "03-saved-reply" },
  { at: 15.6, name: "04-review-finds" },
  { at: 17.9, name: "05-review-card", left: true },
  { at: 20.3, name: "06-fix-all-safe" },
  { at: 23.6, name: "07-style-advice" },
  { at: 27.5, name: "08-ten-languages" },
  { at: 33.0, name: "09-where-you-write" },
  { at: 38.6, name: "10-local-ai-rewrite" },
  { at: 44.8, name: "11-privacy" },
  { at: 58.6, name: "12-logo" },
];
const LOGO_AT = 58.6;

const frames = await mkdtemp(join(tmpdir(), "promo-store-"));
try {
  const times = [...new Set([...SHOTS.map((s) => s.at), LOGO_AT])];
  execFileSync(
    "npx",
    [
      "hyperframes",
      "snapshot",
      "--describe",
      "false",
      "--no-end",
      "--at",
      times.join(","),
      "-o",
      frames,
    ],
    { cwd: dir, stdio: "inherit", env: { ...process.env, HYPERFRAMES_NO_TELEMETRY: "1" } },
  );
  const files = await readdir(frames);
  const frameAt = (at: number) => {
    const file = files.find((f) => f.endsWith(`-at-${at}s.png`));
    if (!file) throw new Error(`No snapshot at ${at} s`);
    return join(frames, file);
  };
  // `crop=w:h:x:y`, then scale; `format=rgb24` drops any alpha channel.
  const image = (source: string, crop: string, size: string, target: string) =>
    execFileSync("ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      source,
      "-vf",
      `crop=${crop},scale=${size}:flags=lanczos,format=rgb24`,
      "-frames:v",
      "1",
      join(out, target),
    ]);

  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
  for (const shot of SHOTS) {
    image(
      frameAt(shot.at),
      `1728:1080:${shot.left ? 0 : 96}:0`,
      "1280:800",
      `screenshot-${shot.name}-1280x800.png`,
    );
  }
  image(frameAt(LOGO_AT), "1920:768:0:170", "1400:560", "marquee-1400x560.png");
  image(frameAt(LOGO_AT), "1100:700:410:190", "440:280", "small-tile-440x280.png");
  console.log(`Wrote ${SHOTS.length + 2} store images to renders/store/.`);
} finally {
  await rm(frames, { recursive: true, force: true });
}
