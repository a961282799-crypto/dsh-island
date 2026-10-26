import test from 'node:test';
import assert from 'node:assert/strict';
import {ActivityStore} from '../src/state.js';
import {normalizeSettings,windowBounds,containsPoint} from '../src/geometry.js';
test('full turn: thinking, streaming, parallel tools, approval, success and quiet idle',()=>{
  let now=1000;const s=new ActivityStore(()=>now);
  s.event('a',{type:'turn/start'});assert.equal(s.snapshot().state,'thinking');
  s.stream('a',{type:'chunk',chunk:{type:'text-delta',text:'private'}});assert.equal(s.snapshot().state,'streaming');
  s.event('a',{type:'tool/call',data:{callId:'x',name:'read_file',arguments:'secret'}});
  s.event('a',{type:'tool/call',data:{callId:'y',name:'write_file'}});
  s.event('a',{type:'approval/asked',data:{id:'p'}});
  s.stream('a',{type:'chunk',chunk:{type:'text-delta'}});assert.equal(s.snapshot().state,'waiting');
  s.event('a',{type:'tool/result',data:{message:{toolCallId:'x'}}});assert.equal(s.snapshot().state,'waiting');
  s.event('a',{type:'approval/decided',data:{id:'p'}});assert.equal(s.snapshot().state,'tools');
  s.event('a',{type:'tool/result',data:{message:{toolCallId:'y'}}});assert.equal(s.snapshot().state,'thinking');
  now+=2000;s.event('a',{type:'turn/end',data:{reason:{kind:'completed'}}});assert.equal(s.snapshot().state,'completed');
  assert.equal(s.snapshot().ended,3000);assert.doesNotMatch(JSON.stringify(s.snapshot()),/private|secret|arguments/);
  now+=7000;assert.equal(s.snapshot().state,'idle');
});
test('cancellation, blocked turns, limits and failures never show success',()=>{
  for(const [kind,state]of [['aborted','paused'],['error','error'],['max-tokens','error'],['blocked','error']]){
    const s=new ActivityStore();s.event('a',{type:'turn/start'});s.event('a',{type:'turn/end',data:{reason:{kind}}});assert.equal(s.snapshot().state,state);
  }
});
test('waiting wins across sessions and one completion cannot hide another running task',()=>{
  const s=new ActivityStore();s.event('a',{type:'turn/start'});s.event('b',{type:'turn/start'});
  s.event('a',{type:'approval/asked',data:{id:'p'}});assert.equal(s.snapshot().sessionId,'a');assert.equal(s.snapshot().activeCount,2);
  s.event('a',{type:'turn/end',data:{reason:{kind:'completed'}}});assert.equal(s.snapshot().sessionId,'b');assert.equal(s.snapshot().activeCount,1);
});
test('reasoning, retries and compaction map to distinct states',()=>{
  const s=new ActivityStore();s.stream('a',{type:'chunk',chunk:{type:'reasoning-delta'}});assert.equal(s.snapshot().state,'thinking');
  s.event('a',{type:'llm/retry'});assert.equal(s.snapshot().state,'reconnecting');
  s.event('a',{type:'llm/retry-started'});assert.equal(s.snapshot().state,'thinking');
  s.event('a',{type:'compaction/start'});assert.equal(s.snapshot().state,'compacting');
});
test('multiple and timed questions stay visible until individually answered',()=>{
  const s=new ActivityStore();s.event('a',{type:'turn/start'});
  for(const id of ['q1','q2'])s.event('a',{type:'tool/call',data:{callId:id,name:'ask_user_question'}});
  s.event('a',{type:'tool/result',data:{message:{toolCallId:'q1',content:[{type:'text',text:'{"pending":true}'}]}}});
  s.event('a',{type:'tool/result',data:{message:{toolCallId:'q2',content:[]}}});assert.equal(s.snapshot().state,'waiting');
  s.event('a',{type:'turn/end',data:{reason:{kind:'completed'}}});assert.equal(s.snapshot().state,'waiting');
  s.event('a',{type:'user/message',data:{source:{kind:'user-question-reply',callId:'q1'}}});assert.notEqual(s.snapshot().state,'waiting');
});
test('old errors do not permanently obscure later work',()=>{
  let now=1000;const s=new ActivityStore(()=>now);s.set('a','error');s.set('b','thinking');assert.equal(s.snapshot().state,'error');now+=16000;assert.equal(s.snapshot().state,'thinking');
});
test('invalid preferences are normalized and all anchors fit negative-origin monitors',()=>{
  assert.deepEqual(normalizeSettings({position:'bad',scale:999,enabled:'yes',displayId:'1'}),{position:'top-center',scale:1,enabled:true,motion:'full',displayId:null});
  for(const position of ['top-center','left-center','right-center','bottom-center','top-left','top-right'])for(const scale of [.85,1,1.15]){
    const area={x:-1920,y:-200,width:1920,height:1040},b=windowBounds(area,{position,scale});
    assert.ok(b.x>=area.x&&b.y>=area.y&&b.x+b.width<=area.x+area.width&&b.y+b.height<=area.y+area.height);
  }
});
test('rounded transparent corners pass through while the visible capsule stays clickable',()=>{
  const rect={x:12,y:12,width:190,height:48,radius:24};
  assert.equal(containsPoint(rect,13,13),false);assert.equal(containsPoint(rect,30,36),true);
  assert.equal(containsPoint(rect,100,36),true);assert.equal(containsPoint(rect,100,70),false);
});
