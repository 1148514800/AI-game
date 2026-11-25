// Native coordinator measurements: actual Chromium RAF + real authoritative tick.
import {mkdtempSync,mkdirSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {chromium,expect} from '@playwright/test';
import {createApp} from '../../src/server/app.ts';
import {observeGameCanvas,probeRenderer,samplePage} from '../../scripts/performance/page.ts';
const out=resolve(process.env.MISTSEA_PERF_OUT ?? 'evidence/phase3/performance-native');mkdirSync(out,{recursive:false});
const root=mkdtempSync(join(tmpdir(),'mistsea-phase3-perf-'));
const result={startedAt:new Date().toISOString(),environment:'native Linux box; headless Chromium, 1280x960, actual context probe, no paid requests; concurrent soak/validation load may be present',samples:[]};
const browser=await chromium.launch({headless:true,chromiumSandbox:true,ignoreDefaultArgs:['--enable-unsafe-swiftshader']});
const distribution=(values)=>{const s=[...values].sort((a,b)=>a-b);return {count:s.length,mean:s.reduce((a,b)=>a+b,0)/s.length,p95:s[Math.ceil(s.length*.95)-1],max:s.at(-1)}};
let n=0;
async function scenario(name,autonomy,task){
 const ticks=[];const app=createApp({savePath:join(root,String(n++)+'.sqlite'),staticRoot:resolve('release/client'),dialogueEnv:{LLM_ENABLED:'false',LLM_AUTONOMY_ENABLED:'false',LLM_MOCK_AUTONOMY_ENABLED:String(autonomy),LLM_MOCK_DELAY_MS:name==='dialogue-pending'?'8500':'120',LLM_MAX_REQUESTS_PER_MINUTE:'24',LLM_AUTONOMY_REQUESTS_PER_MINUTE:'20'},observeTick:s=>ticks.push({at:Date.now(),...s})});
 const url=await app.listen({host:'127.0.0.1',port:0}); const page=await browser.newPage({viewport:{width:1280,height:960}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{await observeGameCanvas(page);await page.goto(url);await expect(page.locator('#game')).toHaveAttribute('data-ready','true');
 const sample=await task(page);const frames=sample.frames;const relevant=ticks.filter(s=>s.at>=frames.startEpochMs&&s.at<=frames.endEpochMs);
 const times=frames.frameTimesMs;const row={name,...sample,observedRafFps:times.length*1000/times.reduce((a,b)=>a+b,0),frameMs:distribution(times),tickCallbackMs:distribution(relevant.map(t=>t.durationMs)),tickIntervalMs:distribution(relevant.map(t=>t.elapsedMs)),errors};result.samples.push(row);writeFileSync(join(out,'results.json'),JSON.stringify(result,null,2)+'\n');if(errors.length)throw Error('Browser runtime errors');console.log(name,JSON.stringify({fps:row.observedRafFps,frame:row.frameMs,tick:row.tickCallbackMs}));
 }finally{await page.close();await app.close()}
}
try{
 result.rendererProbe=await probeRenderer(browser);
 await scenario('idle',false,p=>samplePage(p,'idle',join(out,'idle.png')));
 await scenario('autonomy-active',true,async page=>{
  await expect(page.locator('#game')).toHaveAttribute('data-cenyan-activity','moving',{timeout:15000});
  const frames=await page.evaluate(()=>new Promise(resolve=>{const values=[];const states=[];let start,prev;const state=()=>{const e=document.querySelector('#game');return {ready:e.dataset.ready,activity:e.dataset.cenyanActivity,x:e.dataset.cenyanX,y:e.dataset.cenyanY,visible:document.visibilityState}};let first;function frame(now){if(first===undefined){first=prev=now;start=state()}else values.push(now-prev);prev=now;states.push(state());if(now-first<5000)return requestAnimationFrame(frame);resolve({startEpochMs:performance.timeOrigin+first,endEpochMs:performance.timeOrigin+now,frameTimesMs:values,start,end:state(),states})}requestAnimationFrame(frame)}));
  await page.screenshot({path:join(out,'autonomy-active.png')});return {frames,renderer:'see shared native context probe; same default Canvas path'};
 });
 await scenario('npc-construction',true,async page=>{
  await expect(page.locator('#game')).toHaveAttribute('data-cenyan-activity','working',{timeout:110000});
  const frames=await page.evaluate(()=>new Promise(resolve=>{const times=[];let first,previous,start;const state=()=>({activity:document.querySelector('#game').dataset.cenyanActivity,progress:document.querySelector('#progress').value});function next(now){if(first===undefined){first=now;start=state()}else times.push(now-previous);previous=now;if(now-first<5000)return requestAnimationFrame(next);resolve({startEpochMs:performance.timeOrigin+first,endEpochMs:performance.timeOrigin+now,frameTimesMs:times,start,end:state()})}requestAnimationFrame(next)}));
  if(frames.start.activity!=='working'||frames.end.activity!=='working'||frames.end.progress<=frames.start.progress)throw Error('Construction sample invalid');
  await page.screenshot({path:join(out,'npc-construction.png')});return {frames,renderer:'same native Canvas path'};
 });
 await scenario('dialogue-pending',false,p=>samplePage(p,'dialogue-pending',join(out,'dialogue-pending.png'),{input:'#dialogue-input',send:'#dialogue-send',pending:'#dialogue-pending',mockBadge:'#dialogue-mode',delayEnv:'LLM_MOCK_DELAY_MS'}));
 result.finishedAt=new Date().toISOString();result.exitCode=0;
}finally{await browser.close();rmSync(root,{recursive:true,force:true});writeFileSync(join(out,'results.json'),JSON.stringify(result,null,2)+'\n')}
