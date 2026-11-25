import hashlib,json,zipfile
from pathlib import Path
root=Path("evidence/phase3/acceptance-final")
trace=root/"playwright-artifacts/dialogue.e2e.ts-Phase-3-au-beaf2-ith-folded-responsive-debug/trace.zip"
def nodes(value):
    if isinstance(value,dict):
        if value.get("id")=="game" and "data-cenyan-x" in value: yield value
        for child in value.values(): yield from nodes(child)
    elif isinstance(value,list):
        for child in value: yield from nodes(child)
rows=[]
with zipfile.ZipFile(trace) as z:
    for name in z.namelist():
        if not name.endswith(".trace"):continue
        for line in z.read(name).decode().splitlines():
            event=json.loads(line)
            if event.get("type")!="frame-snapshot":continue
            snap=event["snapshot"]
            for attrs in nodes(snap.get("html")):
                rows.append({"traceTimeMs":snap.get("timestamp"),"snapshot":snap.get("snapshotName"),"cenyan":{key.removeprefix("data-cenyan-"):value for key,value in attrs.items() if key.startswith("data-cenyan-")},"player":{"x":attrs.get("data-x"),"y":attrs.get("data-y")}})
assert len(rows)>5
out=root/"browser-npc-trajectory.json"
out.write_text(json.dumps({"source":"Actual Playwright DOM snapshots; sparse observations, not interpolated WS data", "trace":str(trace),"traceSha256":hashlib.sha256(trace.read_bytes()).hexdigest(),"samples":rows},ensure_ascii=False,indent=2)+"\n")
print(out,"samples",len(rows),"positions",len({(r["cenyan"]["x"],r["cenyan"]["y"]) for r in rows}))
