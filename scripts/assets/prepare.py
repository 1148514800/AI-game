"""Deterministic extraction of a small CC0 runtime subset. Requires Pillow."""
from pathlib import Path
from PIL import Image
import zipfile,hashlib,json,io
ROOT=Path(__file__).resolve().parents[2]; archive=ROOT/'assets/source/ninja-adventure-2026-03-29.zip';z=zipfile.ZipFile(archive);prefix='Ninja Adventure - Asset Pack/'
sha=lambda b:hashlib.sha256(b).hexdigest();records=[];out=ROOT/'public/assets';out.mkdir(parents=True,exist_ok=True)
existing_manifest=ROOT/'assets/manifest.json'
if existing_manifest.exists():
 expected=json.loads(existing_manifest.read_text())['archiveSha256']
 if sha(archive.read_bytes())!=expected:raise SystemExit('Original archive checksum changed; new license review required')
license_text=z.read(prefix+'LICENSE.txt');assert license_text.startswith(b'CC0 1.0 Universal');(ROOT/'assets/licenses/NinjaAdventure-CC0.txt').write_bytes(license_text)
def emit(name,src,category,crop=None):
 original=z.read(prefix+src);target=out/name
 if crop:
  image=Image.open(io.BytesIO(original));image.crop(crop).save(target)
 else: target.write_bytes(original)
 records.append(dict(assetId=name,pack='Ninja Adventure',authors=['Pixel-Boy','AAA'],sourceUrl='https://pixel-boy.itch.io/ninja-adventure-asset-pack',version='itch upload 16981275 / 2026-03-29 (Update 8)',acquired='2026-11-24 Asia/Shanghai',license='CC0-1.0',originalPath=prefix+src,outputPath='public/assets/'+name,originalSha256=sha(original),sha256=sha(target.read_bytes()),modifications=('Lossless crop '+str(crop)) if crop else 'None; exact bytes',category=category))
for actor,key in [('NinjaBlue','player'),('OldMan','npc')]:
 for anim in ['Walk','Idle']:emit(f'{key}-{anim.lower()}.png',f'Actor/Character/{actor}/SeparateAnim/{anim}.png','characters/animation')
emit('grass.png','Backgrounds/Tilesets/TilesetFloor.png','terrain',(0,192,16,208))
emit('path.png','Backgrounds/Tilesets/TilesetFloor.png','terrain',(16,128,32,144))
emit('tree.png','Backgrounds/Tilesets/TilesetNature.png','plants',(0,0,32,32))
emit('house.png','Backgrounds/Tilesets/TilesetHouse.png','buildings',(0,0,64,48))
emit('flowers.png','Backgrounds/Tilesets/TilesetNature.png','plants',(0,160,16,176))
emit('letter.png','Items/Other/Letter.png','items')
emit('arrow.png','Ui/Arrow.png','ui')
emit('village.ogg','Audio/Musics/36 - Village.ogg','music')
emit('alert.wav','Audio/Sounds/Alert/Alert.wav','sound-effects')
manifest=dict(schemaVersion=1,archive='assets/source/'+archive.name,archiveSha256=sha(archive.read_bytes()),licenseFile='assets/licenses/NinjaAdventure-CC0.txt',assets=records)
(ROOT/'assets/manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
# Inventory all source files by category without adding them all to runtime.
inventory={}
for n in z.namelist():
 if not n.endswith('/'):
  rel=n.removeprefix(prefix);category=rel.split('/')[0];inventory.setdefault(category,[]).append(rel)
(ROOT/'assets/source/inventory.json').write_text(json.dumps(inventory,ensure_ascii=False,indent=2)+'\n')
anims={'frameWidth':16,'frameHeight':16,'directionColumns':{'down':0,'up':1,'left':2,'right':3},'walk':{'frameRate':8,'framesByDirection':{d:[c,c+4,c+8,c+12] for d,c in {'down':0,'up':1,'left':2,'right':3}.items()}},'idle':{'framesByDirection':{'down':[0],'up':[1],'left':[2],'right':[3]}}}
(ROOT/'data/animations.json').write_text(json.dumps(anims,indent=2)+'\n')
trees=[[24,48],[57,44],[90,40],[266,45],[293,54],[27,101],[293,109],[34,196],[69,206],[278,201],[308,192]]
objects=[{'id':'preview-house-01','type':'house','x':76,'y':93},*({'id':f'tree-{i:02}','type':'tree','x':x,'y':y} for i,(x,y) in enumerate(trees))]
for i,obj in enumerate(objects,1):
 stable_id=obj['id'];obj['id']=i;obj['properties']=[{'name':'stableId','type':'string','value':stable_id}];obj.update(width=0,height=0,rotation=0,visible=True)
mapdata={'nextlayerid':3,'nextobjectid':len(objects)+1,'type':'map','version':'1.10','orientation':'orthogonal','renderorder':'right-down','width':20,'height':14,'tilewidth':16,'tileheight':16,'infinite':False,'tilesets':[{'firstgid':1,'name':'grass','image':'/assets/grass.png','imagewidth':16,'imageheight':16,'tilewidth':16,'tileheight':16,'tilecount':1,'columns':1},{'firstgid':2,'name':'path','image':'/assets/path.png','imagewidth':16,'imageheight':16,'tilewidth':16,'tileheight':16,'tilecount':1,'columns':1}],'layers':[{'id':1,'name':'ground','type':'tilelayer','width':20,'height':14,'visible':True,'opacity':1,'x':0,'y':0,'data':[2 if (6<=y<=8 or 9<=x<=10) else 1 for y in range(14) for x in range(20)]},{'id':2,'name':'preview-props','type':'objectgroup','objects':objects}]}
(ROOT/'data/preview-map.json').write_text(json.dumps(mapdata,ensure_ascii=False,indent=2)+'\n')
print('Prepared',len(records),'runtime assets; original ZIP unchanged:',sha(archive.read_bytes()))
