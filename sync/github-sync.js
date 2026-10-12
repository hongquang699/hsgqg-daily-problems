'use strict';
const fs=require('node:fs');
const path=require('node:path');
const https=require('node:https');
const crypto=require('node:crypto');
const ROOT=path.resolve(__dirname,'..');
const CONFIG=path.join(ROOT,'sync.config.json');
const TARGET=path.join(ROOT,'problems');
const STATUS=path.join(ROOT,'sync','status.json');
const MAX_BYTES=12*1024*1024;
let busy=false;
function readJSON(p){return JSON.parse(fs.readFileSync(p,'utf8'));}
function status(s){fs.writeFileSync(STATUS,JSON.stringify({...s,checkedAt:new Date().toISOString()},null,2));}
function validPath(s){return typeof s==='string' && /^(days\/\d{4}-\d{2}-\d{2}\/)?[a-zA-Z0-9_./-]+\.json$/.test(s) && !s.split('/').includes('..') && !s.startsWith('/');}
function download(url){return new Promise((resolve,reject)=>{
  if(url.protocol!=='https:'||url.hostname!=='raw.githubusercontent.com')return reject(Error('Untrusted host'));
  const req=https.get(url,{timeout:12000,headers:{'User-Agent':'HSGQG-Local-Judge/2'}},res=>{
    if(res.statusCode!==200){res.resume();return reject(Error('GitHub HTTP '+res.statusCode));}
    let n=0;const chunks=[];
    res.on('data',b=>{n+=b.length;if(n>MAX_BYTES){req.destroy(Error('File too large'));return;}chunks.push(b);});
    res.on('end',()=>resolve(Buffer.concat(chunks)));
    res.on('error',reject);
  });req.on('timeout',()=>req.destroy(Error('Request timeout')));req.on('error',reject);
});}
function validate(contest,tests){
 if(!contest||typeof contest.title!=='string'||!Array.isArray(contest.problems)||contest.problems.length<1||contest.problems.length>30)throw Error('Invalid contest');
 const ids=new Set();
 for(const p of contest.problems){
  if(!p||!/^[-A-Z0-9_]{2,32}$/.test(p.id)||ids.has(p.id)||typeof p.title!=='string'||typeof p.statement!=='string'||!Number.isInteger(p.timeLimitMs)||p.timeLimitMs<100||p.timeLimitMs>15000||!Number.isInteger(p.memoryLimitMb)||p.memoryLimitMb<16||p.memoryLimitMb>1024||!Array.isArray(p.subtasks)||p.subtasks.length<1)throw Error('Invalid problem');
  ids.add(p.id);
  const points=p.subtasks.reduce((a,s)=>a+s.points,0);
  if(points!==100||p.subtasks.some(s=>!Number.isInteger(s.points)||s.points<0))throw Error('Subtask points must sum to 100');
  if(!Array.isArray(tests[p.id])||tests[p.id].length<1||tests[p.id].length>500)throw Error('Invalid tests for '+p.id);
  for(const t of tests[p.id])if(typeof t.input!=='string'||typeof t.output!=='string'||t.input.length>1000000||t.output.length>1000000||!Number.isInteger(t.subtask)||t.subtask<1||t.subtask>p.subtasks.length)throw Error('Invalid test');
  for(let i=1;i<=p.subtasks.length;i++)if(!tests[p.id].some(t=>t.subtask===i))throw Error('Missing subtask tests');
 }
}
function localDate(){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Ho_Chi_Minh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());}
function localTime(){return new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Ho_Chi_Minh',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date());}
async function sync({force=false}={}){
 if(busy)return {ok:false,message:'Sync already running'};
 busy=true;
 try{
  if(!fs.existsSync(CONFIG))throw Error('Missing sync.config.json; copy sync.config.example.json');
  const cfg=readJSON(CONFIG);
  if(!/^[A-Za-z0-9-]{1,39}$/.test(cfg.owner)||!/^[A-Za-z0-9_.-]{1,100}$/.test(cfg.repo)||!/^[A-Za-z0-9_.\/-]{1,100}$/.test(cfg.branch)||cfg.branch.includes('..'))throw Error('Invalid GitHub config');
  const base=`https://raw.githubusercontent.com/${cfg.owner}/${cfg.repo}/${cfg.branch}/`;
  const manifest=JSON.parse((await download(new URL('manifest.json',base))).toString('utf8'));
  if(manifest.schemaVersion!==1||!Array.isArray(manifest.releases))throw Error('Invalid manifest');
  const today=localDate();
  const eligible=manifest.releases.filter(x=>/^\d{4}-\d{2}-\d{2}$/.test(x.date)&&x.date<=today&&validPath(x.contest)&&validPath(x.tests)&&/^[a-f0-9]{64}$/.test(x.contestSha256)&&/^[a-f0-9]{64}$/.test(x.testsSha256)).sort((a,b)=>b.date.localeCompare(a.date));
  if(!eligible.length)throw Error('No published release available');
  const chosen=eligible[0];
  const activePath=path.join(TARGET,'active.json');
  const activeFolder=fs.existsSync(activePath)?path.join(TARGET,'versions',readJSON(activePath).directory):TARGET;
  const statePath=path.join(activeFolder,'sync-state.json');
  if(!force&&fs.existsSync(statePath)){
   const old=readJSON(statePath);
   if(old.date===chosen.date&&old.contestSha256===chosen.contestSha256&&old.testsSha256===chosen.testsSha256){status({ok:true,message:'Already up to date',date:chosen.date});return {ok:true,updated:false,date:chosen.date};}
  }
  const [cb,tb]=await Promise.all([download(new URL(chosen.contest,base)),download(new URL(chosen.tests,base))]);
  const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
  if(sha(cb)!==chosen.contestSha256||sha(tb)!==chosen.testsSha256)throw Error('SHA256 mismatch; rejected');
  const contest=JSON.parse(cb.toString('utf8'));const tests=JSON.parse(tb.toString('utf8'));
  validate(contest,tests);
  const stage=fs.mkdtempSync(path.join(ROOT,'sync','stage-'));
  try{
   fs.writeFileSync(path.join(stage,'contest.json'),cb);
   fs.writeFileSync(path.join(stage,'tests.json'),tb);
   fs.writeFileSync(path.join(stage,'sync-state.json'),JSON.stringify({date:chosen.date,contestSha256:chosen.contestSha256,testsSha256:chosen.testsSha256},null,2));
   // Publish versioned directory, then atomically switch the pointer. In-flight judging keeps its old snapshot.
   const versions=path.join(TARGET,'versions');fs.mkdirSync(versions,{recursive:true});
   const name=chosen.date+'-'+chosen.contestSha256.slice(0,12);
   const dest=path.join(versions,name);
   if(!fs.existsSync(dest))fs.renameSync(stage,dest);else fs.rmSync(stage,{recursive:true,force:true});
   const pointer=path.join(TARGET,'active.json');const temp=pointer+'.tmp';
   fs.writeFileSync(temp,JSON.stringify({directory:name}));fs.renameSync(temp,pointer);
   status({ok:true,message:'Updated',date:chosen.date});
   return {ok:true,updated:true,date:chosen.date};
  }finally{if(fs.existsSync(stage))fs.rmSync(stage,{recursive:true,force:true});}
 }catch(e){status({ok:false,message:e.message});return {ok:false,error:e.message};}
 finally{busy=false;}
}
function current(){
 const pointer=path.join(TARGET,'active.json');
 const folder=fs.existsSync(pointer)?path.join(TARGET,'versions',readJSON(pointer).directory):TARGET;
 return {contest:readJSON(path.join(folder,'contest.json')),tests:readJSON(path.join(folder,'tests.json'))};
}
function schedule(){
 let last='',lastAttempt=0;
 async function tick(){const d=localDate();const t=localTime();if(t<'19:00'||last===d||Date.now()-lastAttempt<10*60*1000)return;lastAttempt=Date.now();const result=await sync();if(result.ok)last=d;console.log('[sync 19:00]',result);}
 // Catch up on startup, even when machine was off at 19:00.
 sync().then(r=>{if(r.ok&&localTime()>='19:00')last=localDate();console.log('[sync startup]',r);});
 setInterval(tick,30000).unref();
}
module.exports={sync,current,schedule,localDate};
if(require.main===module)sync({force:process.argv.includes('--force')}).then(r=>{console.log(r);process.exitCode=r.ok?0:1;});
