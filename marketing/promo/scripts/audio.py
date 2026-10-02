"""Original 42s instrumental bed + quiet UI accents. No external samples."""
from array import array
from math import sin, pi, exp, tanh
from pathlib import Path
import wave
SR=48000; D=42; samples=array('f',[0.0])*(SR*D)
# Original sparse Dmaj7 / Bm7 / Gmaj7 / Aadd9 progression, 100 BPM.
chords=[(146.832,184.997,220,277.183),(123.471,146.832,184.997,220),(97.999,123.471,146.832,184.997),(110,138.591,164.814,246.942)]
def tone(start,length,freq,gain,kind='pad',pan=0):
 begin=int(start*SR); end=min(len(samples),begin+int(length*SR))
 for j in range(begin,end):
  t=(j-begin)/SR
  if kind=='pad': env=min(t/.15,1)*min((length-t)/.6,1); v=(sin(2*pi*freq*t)+.18*sin(4*pi*freq*t))*.65
  else: env=(1-exp(-t*180))*exp(-t*7);v=sin(2*pi*freq*t)+.25*sin(2*pi*freq*2*t)
  samples[j]+=gain*env*v
for bar in range(18):
 at=bar*2.4; chord=chords[(bar//2)%4]
 for f in chord:tone(at,2.55,f,.021)
 for k in range(4):tone(at+k*.6,.7,chord[(k+bar)%4]*2,.032,'pluck')
# Acceptance and correction cues, quieter than the bed.
for at in (1.5,10.8,23.5,28.6):
 tone(at,.28,659.255,.043,'pluck');tone(at+.07,.25,880,.03,'pluck')
for at in (3.6,4.1,4.6,5.1,5.6,6.1,6.6):tone(at,.05,1800,.014,'pluck')
out=array('h')
for i,v in enumerate(samples):
 t=i/SR;fade=min(t/.35,1,max(0,(D-t)/2.3));q=int(32767*tanh(v*fade*4));out.extend((q,q))
p=Path(__file__).resolve().parents[1]/'assets/audio/original-score.wav';p.parent.mkdir(parents=True,exist_ok=True)
with wave.open(str(p),'wb') as w:w.setnchannels(2);w.setsampwidth(2);w.setframerate(SR);w.writeframes(out.tobytes())
assert max(abs(x) for x in out)<32767
print(p, '42s stereo, peak',round(max(abs(x) for x in out)/32767,4))
