import test from 'node:test';
import assert from 'node:assert/strict';
import {ApprovalDesk,summarizeCall,callDetail} from '../src/approvals.js';

function fakeCtx(roots){
  const hooks=[];
  return {
    hooks,get:name=>name==='agents'?{roots:()=>roots}:undefined,
    on(name,cb,options={}){const hook={name,cb};hooks[options.prepend?'unshift':'push'](hook);return()=>hooks.splice(hooks.indexOf(hook),1);},
    waterfall(name,request,inner){const cbs=hooks.filter(h=>h.name===name).map(h=>h.cb);const next=()=>(cbs.shift()??inner)(request,next);return next();}
  };
}
const session=(events=[])=>({id:'s1',seq:events.length,eventAt:i=>events[i]});
const toolCall=(callId,name,args)=>({type:'tool/call',data:{callId,name,arguments:JSON.stringify(args)}});

test('the island can allow first and retires the Harness card through the downstream signal',async()=>{
  const agent={session:session([toolCall('c1','bash',{command:'npm publish'})])};
  const ctx=fakeCtx([agent]);const desk=new ApprovalDesk(ctx);desk.attach();
  let webSignal;ctx.on('approval/request',req=>{webSignal=req.signal;return new Promise(()=>{});});
  const tool=new AbortController();
  const decided=ctx.waterfall('approval/request',{agent,toolName:'bash',callId:'c1',reason:'needs network',signal:tool.signal},()=>Promise.resolve('unavailable'));
  const [row]=desk.list();
  assert.deepEqual(row.detail,{label:'命令',text:'npm publish',mono:true});assert.equal(row.reason,'needs network');
  assert.notEqual(webSignal,tool.signal,'Harness card gets a signal the island can end');
  assert.deepEqual(desk.decide(row.id,'allowed-once'),{ok:true});
  assert.equal(await decided,'allowed-once');
  assert.equal(webSignal.aborted,true,'Harness card is retired');
  assert.equal(tool.signal.aborted,false,'the tool itself is not cancelled');
  assert.equal(desk.list().length,0);
  assert.equal(desk.decide(row.id,'rejected').ok,false);
});

test('Harness answering first wins; no window open keeps the island asking; cancellation settles',async()=>{
  const agent={session:session()};const ctx=fakeCtx([agent]);const desk=new ApprovalDesk(ctx);desk.attach();
  ctx.on('approval/request',async()=>'rejected');
  assert.equal(await ctx.waterfall('approval/request',{agent,toolName:'write',signal:new AbortController().signal},()=>Promise.resolve('unavailable')),'rejected');
  assert.equal(desk.list().length,0);

  const ctx2=fakeCtx([agent]);const desk2=new ApprovalDesk(ctx2);desk2.attach();
  const p=ctx2.waterfall('approval/request',{agent,toolName:'write',signal:new AbortController().signal},()=>Promise.resolve('unavailable'));
  await new Promise(r=>setTimeout(r,5));
  assert.equal(desk2.list().length,1,'still asking without a Harness window');
  desk2.decide(desk2.list()[0].id,'rejected');assert.equal(await p,'rejected');

  const c=new AbortController();const p3=ctx2.waterfall('approval/request',{agent,toolName:'write',signal:c.signal},()=>Promise.resolve('unavailable'));
  c.abort();assert.equal(await p3,'cancelled');assert.equal(desk2.list().length,0);
});

test('sub-agents and a disabled desk pass straight through; only allow-once and reject are accepted',async()=>{
  const root={session:session()},sub={session:session()};const ctx=fakeCtx([root]);const desk=new ApprovalDesk(ctx);desk.attach();
  let reached=0;ctx.on('approval/request',async()=>{reached++;return 'allowed-once';});
  await ctx.waterfall('approval/request',{agent:sub,toolName:'bash',signal:new AbortController().signal},()=>0);
  desk.enabled=false;await ctx.waterfall('approval/request',{agent:root,toolName:'bash',signal:new AbortController().signal},()=>0);
  assert.equal(reached,2);
  desk.enabled=true;const p=ctx.waterfall('approval/request',{agent:root,toolName:'bash',signal:new AbortController().signal},()=>new Promise(()=>{}));
  const fresh=fakeCtx([root]);const d2=new ApprovalDesk(fresh);d2.attach();
  const q=fresh.waterfall('approval/request',{agent:root,toolName:'bash',signal:new AbortController().signal},()=>new Promise(()=>{}));
  assert.equal(d2.decide(d2.list()[0].id,'allowed-always').ok,false);
  d2.decide(d2.list()[0].id,'rejected');assert.equal(await q,'rejected');void p;
});

test('call summaries show what is being approved',()=>{
  assert.deepEqual(summarizeCall('pwsh',JSON.stringify({command:'Remove-Item x'})),{label:'命令',text:'Remove-Item x',mono:true});
  assert.equal(summarizeCall('write',JSON.stringify({path:'src/a.js',content:'...'})).label,'修改文件');
  assert.equal(summarizeCall('read',JSON.stringify({path:'README.md'})).label,'文件');
  assert.deepEqual(summarizeCall('web_fetch',JSON.stringify({url:'https://x.dev'})),{label:'网址',text:'https://x.dev',mono:true});
  assert.equal(callDetail(session([toolCall('a','bash',{command:'ls'}),toolCall('b','edit',{path:'x'})]),'a').text,'ls');
  assert.equal(callDetail(session(),'zz'),null);
});
