"""Official zero-price itch.io download; never submits payment or accesses an account."""
import json,urllib.request,hashlib
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
archive=ROOT/'assets/source/ninja-adventure-2026-03-29.zip'
manifest=ROOT/'assets/manifest.json'
expected=json.loads(manifest.read_text())['archiveSha256'] if manifest.exists() else None
if archive.exists():
 if expected and hashlib.sha256(archive.read_bytes()).hexdigest()!=expected: raise SystemExit('Archive checksum mismatch')
 print('Existing original archive verified; no network needed.');raise SystemExit(0)
base='https://pixel-boy.itch.io/ninja-adventure-asset-pack'
req=urllib.request.Request(base+'/file/16981275',data=b'',method='POST')
with urllib.request.urlopen(req,timeout=60) as res: data=json.load(res)
archive.parent.mkdir(parents=True,exist_ok=True)
with urllib.request.urlopen(data['url'],timeout=120) as res: archive.write_bytes(res.read())
actual=hashlib.sha256(archive.read_bytes()).hexdigest()
if expected and actual!=expected:raise SystemExit('Official package changed; do not use before a new license and visual review')
print('Archive SHA256',actual)
