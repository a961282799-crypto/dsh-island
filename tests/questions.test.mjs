import test from 'node:test';
import assert from 'node:assert/strict';
import {QuestionDesk,validateAnswers,normalizeQuestions,answerable} from '../src/questions.js';

// Same composition as cordis Events.waterfall: listeners outermost-first, the last argument is the innermost next.
function fakeCtx(services={}){
  const hooks=[];
  return {
    hooks,services,
    get:name=>services[name],
    on(name,cb,options={}){const hook={name,cb};hooks[options.prepend?'unshift':'push'](hook);return()=>hooks.splice(hooks.indexOf(hook),1);},
    waterfall(name,request,inner){const cbs=hooks.filter(h=>h.name===name).map(h=>h.cb);const next=()=>(cbs.shift()??inner)(request,next);return next();}
  };
}
const agent=id=>({id,session:{id}});
const Q=[{id:'q1',header:'框架',question:'用哪个测试框架？',options:[{label:'Vitest',description:'快'},{label:'Jest'}]},{id:'q2',question:'要覆盖哪些场景？',multiSelect:true,options:[{label:'登录失败'},{label:'锁定'},{label:'找回密码'}]}];
const timedRequest=(a,signal,callId='c1',questions=Q)=>({questions,agent:a,signal,wait:{callId,timed:true}});

test('the island can answer first; Harness UI keeps its card until the shared signal closes it',async()=>{
  const ctx=fakeCtx();let changes=0;const desk=new QuestionDesk(ctx,()=>changes++);desk.attach();
  let webCalled=false;ctx.on('user-questions/request',()=>{webCalled=true;return new Promise(()=>{});});
  const controller=new AbortController();
  const pending=ctx.waterfall('user-questions/request',timedRequest(agent('s'),controller.signal),()=>Promise.reject(Object.assign(new Error('none'),{code:'NO_PROVIDER'})));
  assert.equal(webCalled,true,'Harness UI is still asked');
  const rows=desk.list([]);assert.equal(rows.length,1);assert.equal(rows[0].state,'open');assert.equal(rows[0].questions[1].multiSelect,true);
  assert.deepEqual(desk.answer('c1',[{id:'q1',selected:['Vitest']},{id:'q2',selected:['登录失败','锁定']}]),{ok:true});
  assert.deepEqual(await pending,{answers:[{id:'q1',selected:['Vitest']},{id:'q2',selected:['登录失败','锁定']}]});
  assert.equal(desk.list([]).length,0);assert.ok(changes>=2);
  assert.equal(desk.answer('c1',[{id:'q1',selected:['Jest']},{id:'q2',selected:[]}]).ok,false,'second answer is refused');
});

test('Harness UI answering first wins and the island card disappears',async()=>{
  const ctx=fakeCtx();const desk=new QuestionDesk(ctx);desk.attach();
  ctx.on('user-questions/request',async()=>({answers:[{id:'q1',selected:['Jest']},{id:'q2',selected:[]}]}));
  const result=await ctx.waterfall('user-questions/request',timedRequest(agent('s'),new AbortController().signal),()=>Promise.reject(new Error('x')));
  assert.deepEqual(result.answers[0].selected,['Jest']);assert.equal(desk.list([]).length,0);
});

test('with no Harness window connected the island is the answerer, and the deadline still releases the agent',async()=>{
  const ctx=fakeCtx();const desk=new QuestionDesk(ctx);desk.attach();
  const noProvider=()=>Promise.reject(Object.assign(new Error('no user-questions answerer accepted the request'),{code:'NO_PROVIDER'}));
  const c1=new AbortController();const p1=ctx.waterfall('user-questions/request',timedRequest(agent('a'),c1.signal,'x1'),noProvider);
  await new Promise(r=>setTimeout(r,5));
  assert.equal(desk.list([]).length,1,'still answerable after NO_PROVIDER');
  desk.answer('x1',[{id:'q1',selected:[],custom:'用 node:test'},{id:'q2',selected:['锁定']}]);
  assert.deepEqual((await p1).answers[0],{id:'q1',selected:[],custom:'用 node:test'});
  const c2=new AbortController();const p2=ctx.waterfall('user-questions/request',timedRequest(agent('b'),c2.signal,'x2'),noProvider);
  const timeout=Object.assign(new Error('timed out'),{code:'ASK_TIMED_OUT'});c2.abort(timeout);
  await assert.rejects(p2,e=>e===timeout);assert.equal(desk.list([]).length,0);
});

test('plan reviews, questions with details, untimed asks and a disabled desk pass straight through',async()=>{
  const ctx=fakeCtx();const desk=new QuestionDesk(ctx);desk.attach();let reached=0;
  ctx.on('user-questions/request',()=>{reached++;return Promise.resolve({answers:[]});});
  const s=new AbortController().signal;
  await ctx.waterfall('user-questions/request',timedRequest(agent('a'),s,'p',[{id:'q',question:'批准计划？',detail:'# 计划',intent:{kind:'plan-review',approve:'批准'},options:[{label:'批准'}]}]),()=>0);
  await ctx.waterfall('user-questions/request',{questions:Q,agent:agent('a'),signal:s},()=>0);
  desk.enabled=false;await ctx.waterfall('user-questions/request',timedRequest(agent('a'),s,'d'),()=>0);
  assert.equal(reached,3);assert.equal(desk.list([]).length,0);
});

test('answers are checked against the question batch',()=>{
  const qs=normalizeQuestions(Q);
  assert.equal(validateAnswers(qs,[{id:'q1',selected:['Vitest']}]),null,'missing question');
  assert.equal(validateAnswers(qs,[{id:'q1',selected:['Mocha']},{id:'q2',selected:[]}]),null,'unknown label');
  assert.equal(validateAnswers(qs,[{id:'q1',selected:['Vitest','Jest']},{id:'q2',selected:[]}]),null,'two picks on single select');
  assert.equal(validateAnswers(qs,[{id:'q1',selected:['Vitest']},{id:'q1',selected:['Jest']}]),null,'duplicate id');
  assert.deepEqual(validateAnswers(qs,[{id:'q1',selected:['Vitest'],custom:'  都行  '},{id:'q2',selected:['锁定','锁定'],custom:'还有注册'}]),
    [{id:'q1',selected:[],custom:'都行'},{id:'q2',selected:['锁定'],custom:'还有注册'}]);
  assert.equal(answerable([{id:'a',question:'?',options:Array.from({length:9},(_,i)=>({label:String(i)}))}]),false);
});

test('continued questions are answered through userQuestions.answer and hidden once queued',()=>{
  const root=agent('r');const calls=[];
  const projections={stateOf:(session,unit)=>unit==='userQuestions'&&session===root.session?{questions:{active:[{callId:'k1',state:'continued',questions:Q},{callId:'k2',state:'open',questions:Q}]}}:undefined};
  const service={answer:(a,callId,batch)=>{calls.push([a,callId,batch]);return true;}};
  const desk=new QuestionDesk(fakeCtx({sessionProjections:projections,userQuestions:service}));
  const rows=desk.list([root]);assert.deepEqual(rows.map(r=>[r.callId,r.state]),[['k1','continued']]);
  assert.deepEqual(desk.answer('k1',[{id:'q1',selected:['Jest']},{id:'q2',selected:[]}],[root]),{ok:true});
  assert.equal(calls[0][0],root);assert.equal(calls[0][1],'k1');assert.deepEqual(calls[0][2].answers[0],{id:'q1',selected:['Jest']});
  assert.equal(desk.list([root]).length,0,'hidden while the reply waits for the agent');
  const busy=new QuestionDesk(fakeCtx({sessionProjections:projections,userQuestions:{answer(){throw Object.assign(new Error('q'),{code:'REPLY_QUEUED'});}}}));
  assert.match(busy.answer('k1',[{id:'q1',selected:['Jest']},{id:'q2',selected:[]}],[root]).reason,/等待/);
});
