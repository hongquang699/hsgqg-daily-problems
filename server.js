'use strict';
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const PORT = Number(process.env.PORT || 3000);
const HOST = '127.0.0.1';
const ROOT = __dirname;
const githubSync = require('./sync/github-sync');
const history = [];
const pending = new Set();
function send(res, code, data, type='application/json; charset=utf-8') {
  res.writeHead(code, {'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
  res.end(typeof data === 'string' ? data : JSON.stringify(data));
}
function runDocker(args, timeoutMs, input='') {
  return new Promise(resolve => {
    const containerName = 'hsgqg-' + randomUUID();
    args.splice(1,0,'--name',containerName);
    const child = spawn('docker', args, {stdio:['pipe','pipe','pipe'], windowsHide:true});
    let stdout='',stderr='', settled=false, exceeded=false, truncated=false;
    const timer = setTimeout(() => { exceeded=true; child.kill('SIGKILL'); spawn('docker',['rm','-f',containerName],{stdio:'ignore',windowsHide:true}).on('error',()=>{}); }, timeoutMs);
    function collect(which, chunk) {
      if (which === 'out') stdout += chunk.toString(); else stderr += chunk.toString();
      if (stdout.length + stderr.length > 1024*1024) {truncated=true; child.kill('SIGKILL'); spawn('docker',['rm','-f',containerName],{stdio:'ignore',windowsHide:true}).on('error',()=>{});}
    }
    child.stdout.on('data', x=>collect('out',x));
    child.stderr.on('data', x=>collect('err',x));
    child.on('error', err=>{if (!settled) {settled=true;clearTimeout(timer);resolve({error:err.message,stdout,stderr});}});
    child.on('close', code=>{if (!settled) {settled=true;clearTimeout(timer);resolve({code,stdout,stderr,exceeded,truncated});}});
    child.stdin.on('error',()=>{});
    child.stdin.end(input);
  });
}
const normalize = s => s.trim().split(/\s+/).filter(Boolean).join(' ');
async function judge(sub) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'hsgqg-'));
  const {contest,tests}=sub.snapshot;
  const problem = contest.problems.find(p=>p.id===sub.problemId);
  try {
    fs.writeFileSync(path.join(dir,'main.cpp'),sub.code,{encoding:'utf8',mode:0o644});
    const mount = `${dir}:/work`;
    const common = ['run','--rm','--network','none','--cap-drop','ALL','--security-opt','no-new-privileges','--pids-limit','64','--cpus','1'];
    const compile = await runDocker([...common,'--memory','768m','-v',mount,'-w','/work','gcc:14','g++','-std=c++17','-O2','-pipe','-o','main','main.cpp'],30000);
    if (compile.error || compile.exceeded || compile.code !== 0) {
      sub.verdict = compile.error ? 'SYSTEM ERROR' : compile.exceeded ? 'CE' : 'CE';
      sub.details = (compile.error || compile.stderr || 'Compilation timeout').slice(0,4000);
      sub.status='done';return;
    }
    const testset = tests[sub.problemId] || [];
    const subtaskCount = problem.subtasks.length;
    const outcomes = [];
    for (let i=0;i<testset.length;i++) {
      const t=testset[i];
      const started=Date.now();
      const result=await runDocker([...common,'--memory',`${problem.memoryLimitMb}m`,'--memory-swap',`${problem.memoryLimitMb}m`,'--read-only','--tmpfs','/tmp:rw,noexec,nosuid,size=16m','-v',`${dir}:/work:ro`,'-w','/work','gcc:14','./main'],problem.timeLimitMs+1500,t.input);
      let verdict='AC';
      if (result.error) verdict='SYSTEM ERROR';
      else if (result.exceeded) verdict='TLE';
      else if (result.truncated) verdict='OLE';
      else if (result.code !== 0) verdict='RTE';
      else if (normalize(result.stdout)!==normalize(t.output)) verdict='WA';
      outcomes.push({test:i+1,subtask:t.subtask,verdict,elapsedMs:Date.now()-started});
      if (verdict==='SYSTEM ERROR') break;
    }
    let score=0;
    const subtaskResults=problem.subtasks.map((st,idx)=>{
      const cases=outcomes.filter(o=>o.subtask===idx+1);
      const ok=cases.length>0 && cases.length===testset.filter(t=>t.subtask===idx+1).length && cases.every(o=>o.verdict==='AC');
      if(ok) score+=st.points;
      return {name:st.name,points:st.points,earned:ok?st.points:0,verdict:ok?'AC':(cases.find(o=>o.verdict!=='AC')||{}).verdict||'NOT RUN'};
    });
    sub.score=score;
    sub.verdict=outcomes.every(o=>o.verdict==='AC') && outcomes.length===testset.length?'AC':(outcomes.find(o=>o.verdict!=='AC')||{}).verdict||'SYSTEM ERROR';
    sub.subtasks=subtaskResults;
    sub.tests=outcomes;
    sub.details='Bộ test minh họa cục bộ, không phải bộ test chính thức của kỳ thi.';
    sub.status='done';
  } catch(e) {sub.status='done';sub.verdict='SYSTEM ERROR';sub.details=e.message;}
  finally {fs.rmSync(dir,{recursive:true,force:true});pending.delete(sub.id);}
}
const server=http.createServer((req,res)=>{
  const pathname=new URL(req.url,'http://localhost').pathname;
  if(req.method==='GET'&&pathname==='/api/contest') return send(res,200,githubSync.current().contest);
  if(req.method==='GET'&&pathname==='/api/sync-status') {const p=path.join(ROOT,'sync/status.json');return send(res,200,fs.existsSync(p)?JSON.parse(fs.readFileSync(p,'utf8')):{message:'Not checked yet'});}
  if(req.method==='GET'&&pathname==='/api/submissions') return send(res,200,history.map(({code,snapshot,...rest})=>rest));
  if(req.method==='POST'&&pathname==='/api/submit') {
    if(pending.size>=2) return send(res,429,{error:'Đang chấm tối đa 2 bài, vui lòng thử lại.'});
    let body='';req.on('data',chunk=>{body+=chunk;if(body.length>150000){req.destroy();}});
    req.on('end',()=>{
      let data;try{data=JSON.parse(body);}catch{return send(res,400,{error:'JSON không hợp lệ'});}
      const snapshot=githubSync.current();
      if(typeof data.code!=='string'||!data.code.trim()||data.code.length>100000||!snapshot.contest.problems.some(p=>p.id===data.problemId)) return send(res,400,{error:'Bài hoặc mã nguồn không hợp lệ (tối đa 100 KB).'});
      const sub={id:randomUUID(),problemId:data.problemId,code:data.code,submittedAt:new Date().toISOString(),status:'judging',verdict:'Judging',score:0,snapshot};
      history.unshift(sub);if(history.length>50)history.pop();pending.add(sub.id);
      send(res,202,{id:sub.id});judge(sub);
    });return;
  }
  if(req.method==='GET'&&(pathname==='/'||pathname==='/index.html')) return send(res,200,fs.readFileSync(path.join(ROOT,'public/index.html')),'text/html; charset=utf-8');
  return send(res,404,{error:'Not found'});
});
server.listen(PORT,HOST,()=>console.log(`HSGQG Local Judge: http://${HOST}:${PORT}`));
githubSync.schedule();
