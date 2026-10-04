"""Original 60 s score for promo v2: a quiet open, a build, one held chord, a resolve.

Synthesized locally from sine tones (no samples). Accent times match STORYBOARD.md v2.
"""
from array import array
from math import sin, pi, exp, tanh
from pathlib import Path
import wave

SR = 48000
D = 60
samples = array("f", [0.0]) * (SR * D)
# Dmaj7 / Bm7 / Gmaj7 / Aadd9, 100 BPM (one bar = 2.4 s).
CHORDS = [
    (146.832, 184.997, 220, 277.183),
    (123.471, 146.832, 184.997, 220),
    (97.999, 123.471, 146.832, 184.997),
    (110, 138.591, 164.814, 246.942),
]


def tone(start, length, freq, gain, kind="pad"):
    begin = int(start * SR)
    end = min(len(samples), begin + int(length * SR))
    for j in range(begin, end):
        t = (j - begin) / SR
        if kind == "pad":
            env = min(t / 0.4, 1) * min((length - t) / 0.8, 1)
            v = (sin(2 * pi * freq * t) + 0.18 * sin(4 * pi * freq * t)) * 0.65
        else:
            env = (1 - exp(-t * 180)) * exp(-t * 7)
            v = sin(2 * pi * freq * t) + 0.25 * sin(4 * pi * freq * t)
        samples[j] += gain * env * v


def level(at):
    """Pad and pluck gain by section: open, build, held chord, rebuild, close."""
    if at < 2.0:
        return 0.0, 0.0
    if at < 5.0:
        return 0.014, 0.0
    if at < 24.5:
        return 0.019, 0.026
    if at < 40.5:
        return 0.022, 0.032
    if at < 44.0:
        return 0.0, 0.0
    return 0.021, 0.028


# The caret's note, then the bed in bars.
tone(0.4, 1.8, 587.33, 0.05, "pluck")
for bar in range(25):
    at = 2.0 + bar * 2.4
    if at >= 58.5:
        break
    pad, pluck = level(at)
    chord = CHORDS[(bar // 2) % 4]
    for f in chord:
        tone(at, 2.6, f, pad)
    for k in range(4):
        if pluck:
            tone(at + k * 0.6, 0.7, chord[(k + bar) % 4] * 2, pluck, "pluck")
# Held frame (40.5–44.0): one sustained Gmaj7.
for f in CHORDS[2]:
    tone(40.5, 3.8, f, 0.02)
# Final chord resolves on D at 57.6, ringing to the end.
for f in (146.832, 220, 293.665, 369.994):
    tone(57.6, 2.4, f, 0.024)
# Accents: Tab, Apply, Fix all, language swaps, editor cuts, rewrite, logo.
for at in (3.45, 6.75, 9.35, 11.9, 17.6, 20.0, 36.9, 55.0):
    tone(at, 0.28, 659.255, 0.043, "pluck")
    tone(at + 0.07, 0.25, 880, 0.03, "pluck")
for at in (13.85, 24.5, 25.3, 26.1, 26.9, 27.7, 31.0, 32.5, 34.0):
    tone(at, 0.2, 987.77, 0.026, "pluck")
# Quiet key ticks while lines type themselves.
for start, count, step in ((2.0, 8, 0.1), (3.5, 20, 0.055), (10.5, 6, 0.1), (47.2, 2, 0.7)):
    for k in range(count):
        tone(start + k * step, 0.05, 1800, 0.012, "pluck")

out = array("h")
for i, v in enumerate(samples):
    t = i / SR
    fade = min(t / 0.2, 1, max(0, (D - t) / 1.6))
    q = int(32767 * tanh(v * fade * 4))
    out.extend((q, q))
p = Path(__file__).resolve().parents[1] / "assets/audio/original-score-v2.wav"
p.parent.mkdir(parents=True, exist_ok=True)
with wave.open(str(p), "wb") as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(out.tobytes())
assert max(abs(x) for x in out) < 32767
print(p, "60s stereo, peak", round(max(abs(x) for x in out) / 32767, 4))
