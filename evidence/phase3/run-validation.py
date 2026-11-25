#!/usr/bin/env python3
"""Coordinator native validation. No inherited LLM credentials/configuration."""
import argparse,json,os,subprocess,time
from datetime import datetime,timezone,timedelta
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument("--name",default="validation-final");args=p.parse_args()
root=Path(__file__).resolve().parents[2]
out=root/"evidence"/"phase3"/args.name
out.mkdir(exist_ok=False)
env={k:os.environ[k] for k in ("PATH","HOME","TMPDIR","XDG_CACHE_HOME") if k in os.environ}
env.update({"LLM_ENABLED":"false","LLM_AUTONOMY_ENABLED":"false","LLM_MOCK_AUTONOMY_ENABLED":"false","MISTSEA_EVIDENCE":str(out),"NO_COLOR":"1"})
steps=[("npm-ci",["npm","ci"]),("typecheck",["npm","run","typecheck"]),("unit",["npm","test"]),("integration",["npm","run","test:integration"]),("e2e",["npm","run","test:e2e"]),("build",["npm","run","build"]),("production-smoke",["node","scripts/production-smoke.mjs"])]
summary={"environment":"native box; credential-free explicit test env; no Live calls authorized","started":datetime.now(timezone(timedelta(hours=8))).isoformat(),"steps":[]}
for name,cmd in steps:
    log=out/(name+".log");start=time.monotonic()
    print("START "+name,flush=True)
    with log.open("w") as f:
        f.write("COMMAND "+" ".join(cmd)+"\n");f.flush()
        try:code=subprocess.run(cmd,cwd=root,env=env,stdout=f,stderr=subprocess.STDOUT,timeout=1500).returncode
        except subprocess.TimeoutExpired:code=124
        f.write("\nNATIVE_EXIT="+str(code)+"\n")
    summary["steps"].append({"name":name,"command":cmd,"exitCode":code,"elapsedSeconds":round(time.monotonic()-start,3),"log":str(log)})
    (out/"summary.json").write_text(json.dumps(summary,ensure_ascii=False,indent=2)+"\n")
    print("END "+name+" exit="+str(code),flush=True)
summary["finished"]=datetime.now(timezone(timedelta(hours=8))).isoformat()
summary["allExitZero"]=all(s["exitCode"]==0 for s in summary["steps"])
(out/"summary.json").write_text(json.dumps(summary,ensure_ascii=False,indent=2)+"\n")
raise SystemExit(0 if summary["allExitZero"] else 1)
