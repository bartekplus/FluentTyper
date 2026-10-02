"""Bidirectional screenshot equivalence; tolerates only bounded raster noise."""
from pathlib import Path
from PIL import Image, ImageChops, ImageStat
import json
root=Path(__file__).resolve().parents[1];results=[]
for forward in (root/'renders/qa').glob('seek-forward-*.png'):
 backward=forward.with_name(forward.name.replace('forward','backward'))
 if not backward.exists():raise RuntimeError('Missing '+str(backward))
 a=Image.open(forward).convert('RGB');b=Image.open(backward).convert('RGB')
 d=ImageChops.difference(a,b);stat=ImageStat.Stat(d)
 changed=sum(1 for pixel in d.get_flattened_data() if any(pixel))
 max_delta=max(upper for lower,upper in d.getextrema());fraction=changed/(a.width*a.height)
 passed=max(stat.rms)<.15 and max_delta<=8 and fraction<.001
 results.append({'time':float(forward.stem.removeprefix('seek-forward-')),'rms':max(stat.rms),'max_channel_delta':max_delta,'changed_fraction':fraction,'passed':passed})
assert len(results)==29
report={'passed':all(r['passed'] for r in results),'thresholds':{'rms':.15,'max_channel_delta':8,'changed_fraction':.001},'results':sorted(results,key=lambda r:r['time'])}
(root/'evidence/seek-pixels.json').write_text(json.dumps(report,indent=2))
assert report['passed'],[r for r in results if not r['passed']]
print('PASS: 29 bidirectional rendered frames; max RMS',max(r['rms'] for r in results),'max changed fraction',max(r['changed_fraction'] for r in results))
