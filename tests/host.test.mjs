import test from 'node:test';
import assert from 'node:assert/strict';
import {ActivityStore} from '../src/state.js';
import {islandSnapshot,stopSession,readBalance} from '../src/host.js';
import {Config,readPrefs,DEFAULT_PREFS} from '../src/settings.js';

const agent=(id,status='running')=>{const a={session:{id},status,cancels:[],cancel(...args){a.cancels.push(args);}};return a;};
const fakeCtx=(roots,subs=[])=>({agents:{roots:()=>roots,list:()=>[...roots,...subs],get:id=>[...roots,...subs].find(a=>a.session.id===id)}});

test('plan, tool trail, model and token usage reach the island without prompts or arguments',()=>{
  let now=1000;const s=new ActivityStore(()=>now);
  s.event('a',{type:'session/title',data:{title:'重构登录模块'}});
  s.event('a',{type:'turn/start'});
  s.event('a',{type:'todo/write',data:{todos:[{content:'读代码',status:'completed'},{content:'写测试',status:'in_progress'},{content:'提交',status:'pending'}]}});
  s.event('a',{type:'assistant/attempt',data:{source:{provider:'deepseek',model:'deepseek-v4'}}});
  s.event('a',{type:'tool/call',data:{callId:'1',name:'read',arguments:'{"path":"secret.txt"}'}});
  s.event('a',{type:'tool/call',data:{callId:'2',name:'read'}});
  s.event('a',{type:'tool/call',data:{callId:'3',name:'bash',arguments:'rm -rf secret'}});
  s.event('a',{type:'assistant/message',data:{message:{content:[{type:'text',text:'private reply'}]},usage:{inputTokens:1000,cacheReadTokens:60000,outputTokens:800}}});
  s.event('a',{type:'assistant/message',data:{usage:{inputTokens:2000,cacheReadTokens:61000,outputTokens:400}}});
  const snap=s.snapshot();
  assert.deepEqual(snap.detail.plan,{total:3,done:1,current:'写测试'});
  assert.deepEqual(snap.detail.trail,['read','bash']);
  assert.equal(snap.detail.toolCount,3);
  assert.equal(snap.detail.model,'deepseek-v4');
  assert.equal(snap.detail.contextTokens,63000);
  assert.equal(snap.detail.outputTokens,1200);
  assert.doesNotMatch(JSON.stringify(snap),/secret|private reply|arguments/);
  now+=5000;s.event('a',{type:'turn/end',data:{reason:{kind:'completed'}}});
  const done=s.snapshot().finished.at(-1);
  assert.deepEqual({title:done.title,state:done.state,ms:done.ended-done.started,tools:done.toolCount},{title:'重构登录模块',state:'completed',ms:5000,tools:3});
});

test('sub-agent sessions stay hidden unless they need the user, and only top-level tasks can be stopped',()=>{
  const root=agent('root'),sub=agent('sub');const ctx=fakeCtx([root],[sub]);const s=new ActivityStore();const known=new Set();
  s.event('root',{type:'turn/start'});s.event('sub',{type:'turn/start'});s.event('sub',{type:'tool/call',data:{callId:'x',name:'bash'}});
  let snap=islandSnapshot(ctx,s,known);
  assert.deepEqual(snap.sessions.map(r=>r.id),['root']);
  assert.equal(snap.activeCount,1);assert.equal(snap.sessionId,'root');assert.equal(snap.stoppable,true);
  s.event('sub',{type:'approval/asked',data:{id:'p'}});
  snap=islandSnapshot(ctx,s,known);
  assert.equal(snap.sessionId,'sub');assert.equal(snap.state,'waiting');assert.equal(snap.stoppable,false,'a sub-agent is stopped through its parent');
  assert.equal(stopSession(ctx,'sub'),false);assert.equal(sub.cancels.length,0);
  assert.equal(stopSession(ctx,'missing'),false);
  assert.equal(stopSession(ctx,'root'),true);
  assert.deepEqual(root.cancels,[[{kind:'user'},{keepInbox:true}]]);
});

test('a finished task cannot be stopped',()=>{
  const root=agent('r');const s=new ActivityStore();s.event('r',{type:'turn/start'});s.event('r',{type:'turn/end',data:{reason:{kind:'completed'}}});
  assert.equal(islandSnapshot(fakeCtx([root]),s,new Set()).stoppable,false);
});

test('preferences fall back to defaults for missing or invalid values',()=>{
  assert.deepEqual(readPrefs({}),DEFAULT_PREFS);
  assert.deepEqual(readPrefs({position:'nowhere',size:'huge',popups:false}),{...DEFAULT_PREFS,popups:false});
});

test('Harness config schema: every visible option is volatile and edits apply live',{skip:!Config&&'Harness schema library not reachable from here'},()=>{
  const json=JSON.stringify(Config.toJSON());
  for(const key of ['enabled','position','size','reduceMotion','popups','details','balance','questions'])assert.ok(Config.dict[key].meta.volatile,`${key} is volatile`);
  assert.ok(!Config.dict.dataDir.meta.volatile&&Config.dict.dataDir.meta.hidden);
  assert.match(json,/停靠位置/);
  const parsed=Config({position:'left-center',size:'large'});
  assert.deepEqual(readPrefs(parsed),{...DEFAULT_PREFS,position:'left-center',size:'large'});
  parsed.reduceMotion[Symbol.for('cosmokit.volatile.write')](true);
  assert.equal(readPrefs(parsed).reduceMotion,true);
  assert.throws(()=>Config({position:'middle'}));
  assert.throws(()=>Config({size:'xl'}));
});

test('balance comes only from a signed-in account and never turns a failure into zero',async()=>{
  assert.equal(await readBalance(undefined),null);
  assert.equal(await readBalance({getBalance:async()=>null}),null,'signed out');
  assert.equal(await readBalance({getBalance:async()=>({status:'failed'})}),null,'failed read');
  let seen;
  const b=await readBalance({getBalance:async client=>{seen=client;return {status:'ready',value:[{currency:'CNY',balance:'48.62'},{currency:'XXX',balance:'1'},{currency:'USD',balance:'oops'}],bonusWallets:[{currency:'CNY',balance:'10.00'}]};}});
  assert.deepEqual(b.wallets,[{currency:'CNY',balance:'48.62'}]);assert.deepEqual(b.bonus,[{currency:'CNY',balance:'10.00'}]);
  assert.ok(typeof seen.version==='string'&&typeof seen.locale==='string'&&Number.isFinite(seen.timezoneOffsetSeconds));
});

test('token usage feeds a per-turn cache hit rate',()=>{
  const s=new ActivityStore();s.event('a',{type:'turn/start'});
  s.event('a',{type:'assistant/message',data:{usage:{inputTokens:3000,cacheWriteTokens:1000,cacheReadTokens:36000,outputTokens:500}}});
  assert.equal(s.snapshot().detail.cacheRate,90);
  s.event('a',{type:'turn/end',data:{reason:{kind:'completed'}}});
  const f=s.snapshot().finished.at(-1);assert.deepEqual([f.inputTokens,f.cacheTokens,f.outputTokens],[4000,36000,500]);
});
