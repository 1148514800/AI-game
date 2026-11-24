"""Execute and retain truthful per-command exits (no fabricated PASS)."""
from pathlib import Path
import subprocess,json,datetime,sys
ROOT=Path(__file__).resolve().parents[1]
commands=[('npm ci','npm-ci.log'),('npm run typecheck','typecheck.log'),('npm test','unit-test.log'),('npm run test:e2e','e2e.log'),('npm run build','build.log'),('node scripts/production-smoke.mjs','production-smoke.log'),('npm run assets:fetch','assets-fetch.log'),('npm run assets:prepare','assets-prepare.log')]
results=[]
for command,logfile in commands:
 start=datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=8))).isoformat()
 with (ROOT/'evidence'/logfile).open('w') as log:code=subprocess.run(command,shell=True,cwd=ROOT,stdout=log,stderr=subprocess.STDOUT).returncode
 result={'command':command,'exitCode':code,'status':'PASS' if code==0 else 'FAIL','startedAt':start,'timezone':'Asia/Shanghai','log':'evidence/'+logfile};results.append(result);print(result,flush=True)
 (ROOT/'evidence/command-results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2)+'\n')
 if code:sys.exit(code)
