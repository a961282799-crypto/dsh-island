import test from 'node:test';
import assert from 'node:assert/strict';
import {ActivityStore} from '../src/state.js';
import {ChatDesk} from '../src/chat.js';
import {islandSnapshot} from '../src/host.js';

const agent=(id,status='idle')=>({session:{id},status});
const ctxWith=(agents,controller)=>({agents:{roots:()=>agents.filter(a=>!a.sub),list:()=>agents,get:id=>agents.find(a=>a.session.id===id)},get:name=>name==='sessionController'?controller:undefined});
const finish=(s,id,title,text)=>{s.event(id,{type:'session/title',data:{title}});s.event(id,{type:'turn/start'});s.event(id,{type:'assistant/message',data:{message:{content:[{type:'text',text}]}}});s.event(id,{type:'turn/end',data:{reason:{kind:'completed'}}});};

test('the conversation to continue is the task on show, else the latest top-level one, never a sub-agent',()=>{
  let now=1000;const s=new ActivityStore(()=>now);const known=new Set(['a','b']);const chat=new ChatDesk(ctxWith([agent('a'),agent('b')]));
  finish(s,'a','任务 A','**第一行**\n\n第二行');now+=10;finish(s,'b','任务 B','B 的回复');now+=10;
  s.event('sub',{type:'turn/start'});
  assert.equal(chat.target(s,known,null).sessionId,'b');
  const a=chat.target(s,known,'a');
  assert.deepEqual({id:a.sessionId,title:a.title,reply:a.reply,running:a.running},{id:'a',title:'任务 A',reply:'第一行\n\n第二行',running:false});
  assert.equal(chat.target(s,known,'sub').sessionId,'b','a sub-agent is never the target');
  s.sessions.clear();
  assert.equal(chat.target(s,known,null).sessionId,'b','the last conversation stays available after the store forgets it');
  chat.enabled=false;assert.equal(chat.target(s,known,null),null);
});

test('a message goes through Harness’s own session controller, queued or steering the running turn',async()=>{
  const calls=[];const controller={prompt:async(req,signal)=>{assert.ok(signal instanceof AbortSignal);calls.push(req);return {accepted:true};}};
  const running=agent('a','running');const ctx=ctxWith([running],controller);const s=new ActivityStore();const chat=new ChatDesk(ctx);
  finish(s,'a','任务','好');chat.target(s,new Set(['a']),'a');
  assert.deepEqual(await chat.send('a','  继续，把测试也补上\r\n谢谢  '),{ok:true,mode:'queue'});
  assert.equal(calls[0].sessionId,'a');assert.equal(calls[0].mode,'queue');assert.deepEqual(calls[0].content,[{type:'text',text:'继续，把测试也补上\n谢谢'}]);
  assert.match(calls[0].requestId,/^[0-9a-f-]{36}$/);
  assert.deepEqual(await chat.send('a','换个思路','steer'),{ok:true,mode:'steer'});
  running.status='idle';
  assert.deepEqual(await chat.send('a','插一句','steer'),{ok:true,mode:'queue'},'steering falls back to a new turn once the turn has ended');
  assert.equal(calls.length,3);
});

test('a message is refused for an empty text, another conversation, a closed switch or an old Harness, and Harness errors read plainly',async()=>{
  const s=new ActivityStore();finish(s,'a','任务','好');const known=new Set(['a']);
  const chat=new ChatDesk(ctxWith([agent('a')],{prompt:async()=>{throw Object.assign(new Error('x'),{code:'session/model-unavailable'});}}));chat.target(s,known,'a');
  assert.equal((await chat.send('a','   ')).ok,false);
  assert.equal((await chat.send('other','hi')).ok,false);
  assert.deepEqual(await chat.send('a','hi'),{ok:false,reason:'请先在 Harness 中选择一个可用的模型'});
  assert.equal((await chat.send('a','x'.repeat(8001))).ok,false);
  chat.enabled=false;assert.equal((await chat.send('a','hi')).ok,false);
  const old=new ChatDesk(ctxWith([agent('a')],undefined));old.target(s,known,'a');
  assert.deepEqual(await old.send('a','hi'),{ok:false,reason:'当前 Harness 版本不支持从灵动岛发送'});
});

test('the island snapshot carries the conversation, without title or reply when details are hidden',()=>{
  const s=new ActivityStore();finish(s,'a','任务 A','回复内容');const ctx=ctxWith([agent('a')]);const chat=new ChatDesk(ctx);
  const snap=islandSnapshot(ctx,s,new Set(),null,{chat,prefs:{details:true}});
  assert.deepEqual([snap.chat.sessionId,snap.chat.title,snap.chat.reply],['a','任务 A','回复内容']);
  const hidden=islandSnapshot(ctx,s,new Set(),null,{chat,prefs:{details:false}});
  assert.deepEqual([hidden.chat.title,hidden.chat.reply],['','']);
  assert.equal(islandSnapshot(ctx,s,new Set(),null,{}).chat,null);
});
