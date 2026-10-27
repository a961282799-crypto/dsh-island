import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {estimateCost,isPeak,pricedModel} from '../src/pricing.js';
import {TurnFold,UsageLedger} from '../src/usage.js';

// 2026-10-27 (Tuesday) in Beijing time.
const bj=(h,m=0,day=27)=>Date.UTC(2026,9,day,h-8,m);

test('peak hours follow Beijing weekdays 9-12 and 14-18',()=>{
  assert.equal(isPeak(bj(9)),true);assert.equal(isPeak(bj(11,59)),true);assert.equal(isPeak(bj(12)),false);
  assert.equal(isPeak(bj(13,30)),false);assert.equal(isPeak(bj(17,59)),true);assert.equal(isPeak(bj(18)),false);
  assert.equal(isPeak(bj(10,0,25)),false,'Sunday');
});

test('costs follow the official price table, and unknown models have no estimate',()=>{
  const u={inputTokens:1e6,cacheReadTokens:1e6,cacheWriteTokens:0,outputTokens:1e6};
  assert.equal(estimateCost({model:'deepseek-flash',time:bj(20),...u}).toFixed(2),(1+0.02+4).toFixed(2));
  assert.equal(estimateCost({model:'deepseek-flash',time:bj(10),...u}).toFixed(2),(2+0.04+8).toFixed(2));
  assert.equal(estimateCost({model:'deepseek-v4-pro',time:bj(20),...u}).toFixed(2),(4.5+0.15+13.5).toFixed(2));
  assert.equal(estimateCost({model:'deepseek-v4-flash',time:bj(20),inputTokens:0,cacheReadTokens:0,cacheWriteTokens:1e6,outputTokens:0}),1,'legacy name, cache writes billed as misses');
  assert.equal(estimateCost({model:'gpt-x',time:bj(20),...u}),null);assert.equal(pricedModel('DeepSeek-Flash'),'deepseek-flash');
});

const ev=(seq,type,data,time)=>({seq,type,data,time});
const turnEvents=(base,seq0,model='deepseek-flash')=>[
  ev(seq0,'turn/start',{turn:1},base),ev(seq0+1,'assistant/attempt',{source:{model}},base+10),
  ev(seq0+2,'tool/call',{callId:'x',name:'bash'},base+20),
  ev(seq0+3,'assistant/message',{usage:{inputTokens:2000,cacheReadTokens:60000,outputTokens:500}},base+1000),
  ev(seq0+4,'assistant/message',{usage:{inputTokens:1000,cacheReadTokens:62000,outputTokens:300}},base+2000),
  ev(seq0+5,'turn/end',{reason:{kind:'completed'}},base+5000)];

test('turns fold into usage records and replays are ignored',()=>{
  const f=new TurnFold();const events=[ev(0,'session/title',{title:'重构登录'},bj(20)),...turnEvents(bj(20),1)];
  for(const e of events)f.push(e);for(const e of events)f.push(e);
  assert.equal(f.turns.length,1);const t=f.turns[0];
  assert.deepEqual([t.calls,t.tools,t.inputTokens,t.cacheReadTokens,t.outputTokens,t.state,t.model,t.end-t.start],[2,1,3000,122000,800,'completed','deepseek-flash',5000]);
  assert.ok(Math.abs(t.cost-(3000*1+122000*0.02+800*4)/1e6)<1e-9);
});

test('the ledger backfills Harness sessions once, follows live events, and summarizes by range',async()=>{
  const now=bj(21);const dir=mkdtempSync(join(tmpdir(),'ledger-'));const file=join(dir,'usage.json');
  const logs={a:[ev(0,'session/title',{title:'旧任务'},now-2*86400e3),...turnEvents(now-2*86400e3,1,'deepseek-v4-pro')],
    b:[ev(0,'session/title',{title:'今天的任务'},now-3600e3),...turnEvents(now-3600e3,1)],
    forked:[ev(0,'turn/start',{},now-60e3),ev(1,'assistant/message',{usage:{inputTokens:999999,outputTokens:1}},now-50e3),...turnEvents(now-40e3,2)],
    old:[...turnEvents(now-40*86400e3,0)]};
  let reads=0;
  const query={listSessions:async()=>[{header:{id:'b',createdAt:now-3600e3}},{header:{id:'forked',createdAt:now-60e3}},{header:{id:'a',createdAt:now-2*86400e3}},{header:{id:'old',createdAt:now-40*86400e3}}],
    readSession:async id=>{reads++;return {events:logs[id],inheritedEventCount:id==='forked'?2:0};}};
  const ledger=new UsageLedger({file,now:()=>now});
  assert.equal(await ledger.backfill(query,{pause:async()=>{}}),3,'only sessions from the last 30 days');
  assert.equal(await ledger.backfill(query,{pause:async()=>{}}),0,'read once');assert.equal(reads,3);
  assert.equal(ledger.turns().find(t=>t.sessionId==='forked').inputTokens,3000,'inherited fork events are not counted');
  ledger.ingest('b',ev(7,'turn/start',{turn:2},now-600e3));
  ledger.ingest('b',ev(8,'assistant/message',{usage:{inputTokens:100,cacheReadTokens:900,outputTokens:50}},now-500e3));
  ledger.ingest('b',ev(9,'turn/end',{reason:{kind:'aborted'}},now-400e3));
  const today=ledger.stats('today');
  assert.equal(today.totals.turns,3);assert.equal(today.buckets.length,24);assert.equal(today.byHour,true);
  const b=today.sessions.find(x=>x.id==='b');assert.equal(b.title,'今天的任务');assert.equal(b.turns,2);assert.equal(today.sessions[0].id,'forked','newest first');
  const week=ledger.stats('7d');assert.equal(week.totals.turns,4);assert.equal(week.buckets.length,7);
  assert.deepEqual(week.models.map(m=>m.model),['deepseek-flash','deepseek-v4-pro']);
  assert.ok(week.totals.cost>0&&week.totals.cacheRate>90);
  const panel=ledger.panel();assert.equal(panel.today.runs,3);assert.equal(panel.today.count,2);assert.equal(panel.day.hours.length,24);assert.ok(panel.recent.some(r=>r.title==='今天的任务'&&r.state==='paused'));assert.ok(panel.recent[0].ended>=panel.recent[1].ended);
  ledger.save();const reloaded=new UsageLedger({file,now:()=>now}).load();
  assert.equal(reloaded.stats('7d').totals.turns,4);assert.equal(await reloaded.backfill(query,{pause:async()=>{}}),0,'scanned state is remembered');
  assert.ok(JSON.parse(readFileSync(file,'utf8')).sessions.b.turns.length===2);
});
