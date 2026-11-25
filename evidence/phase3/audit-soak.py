import hashlib,json,math
from pathlib import Path
root=Path("evidence/phase3/soak-vLUMsY")
s=json.loads((root/"summary.json").read_text())
assert s["result"]=="PASS" and s["exitCode"]==0 and s["activeElapsedSec"]>=1800
rows=[json.loads(x) for x in (root/"trajectory.jsonl").read_text().splitlines()]
states=[r for r in rows if r["event"]=="state"]
metrics=[r for r in rows if r["event"]=="metrics"]
previous=None;maxObservedSpeed=0
for r in states:
    bag=r["bag"];b=r["bridge"]
    assert all(isinstance(v,int) and 0<=v<=999 for v in bag.values())
    assert 0<=b["wood"]<=6 and 0<=b["stone"]<=2 and 0<=b["progressMs"]<=14000
    assert b["repaired"]==(b["progressMs"]==14000)
    if b["progressMs"]:assert b["wood"]==6 and b["stone"]==2
    reset=(bag=={"wood":0,"stone":0} and b["wood"]==0 and b["stone"]==0 and not r.get("result") and not r.get("plan"))
    if previous and r["cycle"]==previous["cycle"] and not reset:
        delta=[bag[k]-previous["bag"][k] for k in ["wood","stone"]]
        if any(v<0 for v in delta):
            assert r["result"]=="DELIVERED" and delta==[-6,-2]
        if any(v>0 for v in delta):assert r["result"]=="COLLECTED" and sum(delta)==1 and all(v>=0 for v in delta)
        assert b["progressMs"]>=previous["bridge"]["progressMs"]
        dt=r["elapsedSec"]-previous["elapsedSec"]
        d=math.dist(r["position"],previous["position"])
        assert d<=88*dt+5,"Observed sparse trajectory jumped beyond allowed motion with rounding allowance"
        if dt>.1:maxObservedSpeed=max(maxObservedSpeed,d/dt)
    previous=r
hashes=json.loads(Path("evidence/phase3/soak-runtime-hashes.json").read_text())
assert all(hashlib.sha256(Path(n).read_bytes()).hexdigest()==h for n,h in hashes.items())
def weighted(rows):
    total=sum(r["tickCallbackMs"]["count"] for r in rows)
    return sum(r["tickCallbackMs"]["mean"]*r["tickCallbackMs"]["count"] for r in rows)/total
out={"summary":s,"observedStates":len(states),"trajectoryRows":len(rows),"minuteMetricWindows":len(metrics),"tickSamples":sum(r["tickCallbackMs"]["count"] for r in metrics),"weightedTickCallbackMeanMs":weighted(metrics),"firstThreeWindowsMeanMs":weighted(metrics[:3]),"lastThreeWindowsMeanMs":weighted(metrics[-3:]),"windowTickP95RangeMs":[min(r["tickCallbackMs"]["p95"] for r in metrics),max(r["tickCallbackMs"]["p95"] for r in metrics)],"maxTickCallbackMs":max(r["tickCallbackMs"]["max"] for r in metrics),"maxTickIntervalMs":max(r["tickIntervalMs"]["max"] for r in metrics),"firstRssBytes":metrics[0]["rssBytes"],"lastRssBytes":metrics[-1]["rssBytes"],"maxRssBytes":max(r["rssBytes"] for r in metrics),"allRuntimeHashesUnchanged":len(hashes),"observedChecks":"All sparse logged NPC bags nonnegative/bounded, exact six-wood/two-stone deductions, single-unit harvests, monotonic bridge work outside explicit resets, observed motion within88px/s plus5px rounding allowance. Full tick collision behavior separately tested.","live":"NOT CALLED; all soak ledger rows Mock; chargedTokens are conservative accounting not vendor measured usage"}
assert all(r["mode"]=="mock" for r in s["ledger"])
Path("evidence/phase3/soak-audit.json").write_text(json.dumps(out,ensure_ascii=False,indent=2)+"\n")
print(json.dumps({k:v for k,v in out.items() if k!="summary"},ensure_ascii=False,indent=2))
