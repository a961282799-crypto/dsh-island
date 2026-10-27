import {STATES} from '../src/state.js';

const $=id=>document.getElementById(id);
const island=$('island'),stage=$('stage'),bridge=window.island;
let current={activity:{state:'idle'},settings:{position:'top-center',scale:1,motion:'full'}};
let expanded=false,peek=false,burstUntil=0,lastState='',boundsFrame,burstTimer,peekTimer,leaveTimer,armTimer,hoverTimer,listKey='',autoOpened=false,hoverOpened=false,lastReply='';
const drafts=new Map(),seenAsk=new Set(),seenApproval=new Map(),sentApproval=new Map();

// 出现时短暂"弹出"以示提醒；思考仅在新任务开始时弹出。
const BURST={thinking:1700,waiting:3600,completed:3000,error:3800,paused:2200,offline:2600};
const QUIET=['','idle','completed','paused','error','offline'];
const VERTICAL=['left-center','right-center'];

const motionOn=()=>current.settings.motion!=='reduced'&&!matchMedia('(prefers-reduced-motion: reduce)').matches;
const announceBounds=()=>{
  const r=island.getBoundingClientRect();
  bridge.bounds({x:r.x,y:r.y,width:r.width,height:r.height,radius:parseFloat(getComputedStyle(island).borderTopLeftRadius)||0});
};
new ResizeObserver(announceBounds).observe(island);
// 形变期间持续上报可点击区域，保证透明区域始终穿透。
const trackTransition=(ms=950)=>{
  cancelAnimationFrame(boundsFrame);
  const until=performance.now()+ms;
  const tick=()=>{announceBounds();if(performance.now()<until)boundsFrame=requestAnimationFrame(tick);};
  tick();
};

function shape(){
  const state=island.dataset.state,vertical=VERTICAL.includes(current.settings.position);
  island.dataset.layout=vertical?'v':'h';
  if(expanded)return 'expanded';
  if(peek||Date.now()<burstUntil)return 'burst';
  const idle=state==='idle';
  return vertical?(idle?'v-idle':'v-compact'):(idle?'idle':'compact');
}
function applyShape(){
  const next=shape();
  if(island.dataset.shape!==next){island.dataset.shape=next;trackTransition();}
  fitPanel();
}
function fitPanel(){island.style.height=expanded?`${Math.min(innerHeight-24,$('panel').scrollHeight+76)}px`:'';}

function expand(value){
  expanded=value;peek=false;clearTimeout(peekTimer);clearTimeout(hoverTimer);
  if(!value)hoverOpened=false;
  island.dataset.expanded=String(value);
  $('capsule').setAttribute('aria-expanded',String(value));
  $('capsule').setAttribute('aria-label',value?'收起 DeepSeek 灵动岛':'展开 DeepSeek 灵动岛');
  $('panel').inert=!value;
  if(!value)$('capsule').focus({preventScroll:true});
  if(value)bridge.panel?.();
  if(current.activity)render(current);
  applyShape();trackTransition(1100);
}
function burst(ms){
  burstUntil=Date.now()+ms;clearTimeout(burstTimer);
  burstTimer=setTimeout(applyShape,ms+20);applyShape();
}

// 悬停：轻停片刻先舒展；停留更久（可在设置里关闭）直接展开面板，离开后收回。
const busyHere=()=>!!(askOf()||approvalOf()||document.activeElement?.matches('select,input'));
island.addEventListener('mouseenter',()=>{
  clearTimeout(leaveTimer);clearTimeout(peekTimer);clearTimeout(hoverTimer);
  if(expanded)return;
  peekTimer=setTimeout(()=>{peek=true;applyShape();},140);
  if(current.prefs?.hoverExpand!==false)hoverTimer=setTimeout(()=>{if(!expanded){hoverOpened=true;autoOpened=false;expand(true);}},700);
});
island.addEventListener('mouseleave',()=>{
  clearTimeout(peekTimer);clearTimeout(hoverTimer);
  if(peek){peekTimer=setTimeout(()=>{peek=false;applyShape();},220);}
  if(expanded)leaveTimer=setTimeout(()=>{if(expanded&&!busyHere())expand(false);},hoverOpened?450:6000);
});

$('capsule').addEventListener('click',()=>{autoOpened=false;const pinned=hoverOpened;hoverOpened=false;clearTimeout(hoverTimer);if(pinned&&expanded){applyShape();return;}expand(!expanded);});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&expanded)expand(false);});
document.addEventListener('contextmenu',e=>{e.preventDefault();bridge.menu();});
// 停止任务需要点两次：第一次变红确认，3 秒内再点才真正停止。
function disarm(){clearTimeout(armTimer);$('stop').dataset.armed='false';$('stop-label').textContent='停止任务';}
$('stop').addEventListener('click',()=>{
  if($('stop').dataset.armed!=='true'){$('stop').dataset.armed='true';$('stop-label').textContent='确认停止';armTimer=setTimeout(disarm,3000);return;}
  disarm();bridge.stop(current.activity.sessionId);
});
$('more').addEventListener('click',()=>bridge.menu());
$('open-harness').addEventListener('click',()=>bridge.open());
$('stats').addEventListener('click',()=>bridge.stats?.());
$('reply').addEventListener('click',()=>bridge.open());
$('hide').addEventListener('click',()=>{expand(false);bridge.hide();});
for(const [key,value] of Object.entries(STATES)){const o=document.createElement('option');o.value=key;o.textContent=value.label;$('demo-state').append(o);}
$('demo-state').addEventListener('change',()=>bridge.preview($('demo-state').value));

const clock=a=>{if(!a.started||a.state==='idle')return '';const s=Math.max(0,Math.floor(((a.ended||Date.now())-a.started)/1000));return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;};
function tick(){$('elapsed').textContent=clock(current.activity);}

const TOOL_LABELS={read:'读取文件',read_image:'查看图片',write:'写入文件',edit:'编辑',str_replace_editor:'编辑',glob:'查找文件',grep:'搜索内容',bash:'终端',pwsh:'终端',
  terminal_open:'打开终端',terminal_send:'终端输入',terminal_read:'读取终端',web_search:'联网搜索',web_fetch:'读取网页',todo_write:'更新计划',ask_user_question:'向你提问',
  present:'交付文件',skill:'使用技能',send_message:'子智能体',interrupt_agent:'子智能体',schedule_create:'定时任务',job_output:'后台任务',job_list:'后台任务',
  session_search:'搜索会话',create_goal:'设定目标',update_goal:'更新目标',working_directory:'切换目录',load_workspace_dependencies:'读取依赖'};
const toolLabel=name=>TOOL_LABELS[name]??TOOL_LABELS[String(name).replace(/^mcp__[^_]+__/,'')]??String(name).replace(/^mcp__/,'').replace(/_/g,' ');
const tokens=n=>!n?'0':n<1000?String(n):n<1e6?`${(n/1000).toFixed(n<1e4?1:0)}K`:`${(n/1e6).toFixed(1)}M`;
const duration=ms=>{const m=Math.round(ms/60000);return m<1?'不到 1 分钟':m<60?`${m} 分钟`:`${Math.floor(m/60)} 小时 ${m%60} 分`;};
const short=ms=>{const s=Math.max(0,Math.round(ms/1000));return s<60?`${s} 秒`:`${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;};
const ago=t=>{const m=Math.floor((Date.now()-t)/60000);return m<1?'刚刚':m<60?`${m} 分钟前`:m<1440?`${Math.floor(m/60)} 小时前`:`${Math.floor(m/1440)} 天前`;};
const TINT={thinking:'#6a86ff',streaming:'#4f8dff',tools:'#7a7cff',waiting:'#f5b544',completed:'#3ddc91',paused:'#9aa3b8',error:'#ff6b6b',reconnecting:'#f2b45a',compacting:'#9b8cff',offline:'#6b7385'};
function li(cls,parts){const el=document.createElement('li');el.className='row';for(const [c,text,style] of parts){const span=document.createElement('span');span.className=c;if(text)span.textContent=text;if(style)span.setAttribute('style',style);el.append(span);}if(cls)el.style.setProperty('--c',cls);return el;}

// 提问卡：在灵动岛里直接回答 Agent 的问题（单选、多选、自己输入、跳过，多题逐个回答）。
function askOf(){return current.prefs?.questions!==false?(current.activity?.questions||[])[0]:undefined;}
function draftFor(q){
  if(!drafts.has(q.callId))drafts.set(q.callId,{index:0,sending:false,answers:Object.fromEntries(q.questions.map(x=>[x.id,{selected:[],custom:''}]))});
  return drafts.get(q.callId);
}
function renderAsk(){
  const q=askOf();$('ask').hidden=!q;
  if(!q)return false;
  const d=draftFor(q),item=q.questions[Math.min(d.index,q.questions.length-1)],ans=d.answers[item.id],last=d.index>=q.questions.length-1;
  const details=current.prefs?.details!==false;
  $('ask-title').textContent=(item.header||'Agent 在问你')+(details&&q.title?` · ${q.title}`:'');
  $('ask-step').textContent=q.questions.length>1?`${d.index+1}/${q.questions.length}`:'';
  $('ask-question').textContent=item.question;
  const key=`${q.callId}:${d.index}`;
  if($('ask-options').dataset.key!==key){
    $('ask-options').dataset.key=key;
    $('ask-options').replaceChildren(...item.options.map((o,i)=>{
      const b=document.createElement('button');b.type='button';b.className='ask-opt'+(item.multiSelect?' multi':'');b.dataset.label=o.label;b.style.animationDelay=`${i*35}ms`;
      const mark=document.createElement('span');mark.className='mark';const txt=document.createElement('span');txt.className='txt';
      const label=document.createElement('b');label.textContent=o.label;txt.append(label);
      if(o.description){const small=document.createElement('small');small.textContent=o.description;txt.append(small);b.title=o.description;}
      b.append(mark,txt);return b;}));
    $('ask-options').hidden=!item.options.length;
    $('ask-custom').value=ans.custom;
    $('ask-custom').placeholder=item.options.length?(item.multiSelect?'可以多选，也可以补充说明…':'或者输入你自己的回答…'):'输入你的回答…';
  }
  const result=current.answerResults?.[q.callId];
  if(result&&!result.ok&&d.sending&&result.at>(d.sentAt||0))d.sending=false;
  for(const b of $('ask-options').children)b.setAttribute('aria-pressed',String(ans.selected.includes(b.dataset.label)));
  $('ask-next').textContent=last?'提交':'下一题';
  $('ask-next').disabled=d.sending||(!ans.selected.length&&!ans.custom.trim());
  $('ask-skip').disabled=d.sending;
  const st=$('ask-status');
  st.className='ask-status'+(d.sending?'':result&&!result.ok&&result.at>(d.sentAt||0)?' err':'');
  st.textContent=d.sending?(result?.ok?'已回答':'正在提交…'):result&&!result.ok&&result.at>(d.sentAt||0)?result.reason:'';
  return true;
}
function currentAsk(){const q=askOf();if(!q)return null;const d=draftFor(q);return {q,d,item:q.questions[d.index],ans:d.answers[q.questions[d.index].id]};}
$('ask-options').addEventListener('click',e=>{
  const b=e.target.closest('button[data-label]'),c=currentAsk();if(!b||!c||c.d.sending)return;
  const label=b.dataset.label;
  if(c.item.multiSelect)c.ans.selected=c.ans.selected.includes(label)?c.ans.selected.filter(l=>l!==label):[...c.ans.selected,label];
  else{c.ans.selected=[label];c.ans.custom='';$('ask-custom').value='';}
  renderAsk();
});
$('ask-custom').addEventListener('input',()=>{const c=currentAsk();if(!c)return;c.ans.custom=$('ask-custom').value;if(!c.item.multiSelect&&c.ans.custom.trim())c.ans.selected=[];renderAsk();});
function advance(){
  const c=currentAsk();if(!c||c.d.sending)return;
  if(c.d.index<c.q.questions.length-1){c.d.index++;renderAsk();fitPanel();return;}
  c.d.sending=true;c.d.sentAt=Date.now();
  bridge.answer(c.q.callId,c.q.questions.map(x=>{const a=c.d.answers[x.id];const custom=a.custom.trim();return {id:x.id,selected:a.selected,...(custom?{custom}:{})};}));
  renderAsk();
}
$('ask').addEventListener('submit',e=>{e.preventDefault();if(!$('ask-next').disabled)advance();});
$('ask-skip').addEventListener('click',()=>{const c=currentAsk();if(!c)return;c.ans.selected=[];c.ans.custom='';$('ask-custom').value='';advance();});

// 审批卡：在灵动岛里允许一次或拒绝工具调用；出现后短暂锁定按钮，防止误点。
function approvalOf(){return current.prefs?.approvals!==false?(current.activity?.approvals||[])[0]:undefined;}
function renderApprove(){
  const a=approvalOf();$('approve').hidden=!a;
  if(!a)return false;
  if(!seenApproval.has(a.id))seenApproval.set(a.id,Date.now());
  const details=current.prefs?.details!==false,count=(current.activity.approvals||[]).length;
  $('approve-title').textContent=`${toolLabel(a.toolName)} 需要你批准`+(details&&a.title?` · ${a.title}`:'');
  $('approve-count').textContent=count>1?`还有 ${count-1} 个`:'';
  $('approve-reason').textContent=a.reason||'Agent 想执行一个需要授权的操作。';
  const detail=details?a.detail:null;
  $('approve-detail').hidden=!detail;
  if(detail){$('approve-label').textContent=detail.label;$('approve-text').textContent=detail.text;$('approve-text').classList.toggle('plain',!detail.mono);}
  const sent=sentApproval.get(a.id),result=current.approvalResults?.[a.id],failed=result&&!result.ok&&result.at>(sent||0);
  if(failed)sentApproval.delete(a.id);
  const sending=sentApproval.has(a.id),locked=Date.now()-seenApproval.get(a.id)<600;
  $('approve-allow').disabled=$('approve-reject').disabled=sending||locked;
  if(locked)setTimeout(renderApprove,620-(Date.now()-seenApproval.get(a.id)));
  const st=$('approve-status');st.className='ask-status'+(failed?' err':'');
  st.textContent=sending?'正在提交…':failed?result.reason:'持久授权请在 Harness 中设置';
  return true;
}
function decide(outcome){const a=approvalOf();if(!a||sentApproval.has(a.id)||$('approve-allow').disabled)return;sentApproval.set(a.id,Date.now());bridge.approve(a.id,outcome);renderApprove();}
$('approve').addEventListener('submit',e=>{e.preventDefault();decide('allowed-once');});
$('approve-reject').addEventListener('click',()=>decide('rejected'));

// 上下文占用：鲸鱼外圈按占用比例描边，70% 起变黄，90% 起变红。
function contextOf(d){if(!d?.contextTokens||!d?.contextWindow)return null;return Math.min(100,Math.round(d.contextTokens/d.contextWindow*100));}
function renderRing(state,d){
  const pct=['idle','offline'].includes(state)?null:contextOf(d);
  if(pct==null){delete island.dataset.ctx;return;}
  island.dataset.ctx=pct>=90?'full':pct>=70?'warn':'ok';
  island.style.setProperty('--ctx-pct',String(Math.max(2,pct)));
  $('capsule').title=`上下文已用 ${pct}%`;
}

// 展开面板：进行中显示当前任务卡和其他任务，空闲时显示今天的统计和最近完成。
function renderPanel({activity:a,prefs={},history={},balance,preview}){
  const state=Object.hasOwn(STATES,a.state)?a.state:'offline',details=prefs.details!==false;
  const idle=state==='idle'||state==='offline',d=a.detail||{};
  $('task').hidden=idle;
  $('session-title').textContent=details&&a.title?a.title:idle?'DeepSeek Harness':'当前任务';
  $('status-detail').textContent=STATES[state].detail;
  const plan=d.plan;
  $('plan').hidden=!plan;
  if(plan){$('plan-count').textContent=`${plan.done}/${plan.total}`;$('plan-bar').style.width=`${Math.round(plan.done/Math.max(1,plan.total)*100)}%`;$('plan-current').textContent=details&&state!=='completed'?plan.current:'';}
  const trail=details?(d.trail||[]):[];
  const trailKey=trail.join('|');
  if($('trail').dataset.key!==trailKey){$('trail').dataset.key=trailKey;$('trail').replaceChildren(...trail.map((n,i)=>{const c=document.createElement('span');c.className='chip';c.textContent=toolLabel(n);c.style.animationDelay=`${i*40}ms`;return c;}));}
  $('trail').hidden=!trail.length;
  const pct=contextOf(d);
  const meta=[d.model,d.contextTokens?(pct!=null?`上下文 ${tokens(d.contextTokens)} / ${tokens(d.contextWindow)} (${pct}%)`:`上下文 ${tokens(d.contextTokens)}`):'',d.cacheRate!=null?`缓存命中 ${d.cacheRate}%`:'',d.toolCount?`工具 ${d.toolCount} 次`:'',d.outputTokens?`输出 ${tokens(d.outputTokens)}`:''].filter(Boolean);
  $('meta').replaceChildren(...meta.map(t=>{const s=document.createElement('span');s.textContent=t;return s;}));
  $('activity-note').textContent=preview?'预览模式 · 示例数据，不代表实际任务':'';

  const others=(a.sessions||[]).filter(r=>r.id!==a.sessionId).slice(0,3);
  const recent=(history.recent||[]).slice(0,state==='idle'&&!history.day?.tokens?3:2);
  const key=JSON.stringify([others.map(r=>[r.id,r.state,r.title]),recent.map(r=>r.key),details]);
  if(key!==listKey){
    listKey=key;
    $('other-list').replaceChildren(...others.map((r,i)=>li(TINT[r.state],[[`dot${['completed','paused','error'].includes(r.state)?'':' live'}`],['t',details&&r.title?r.title:`任务 ${i+2}`],['s',STATES[r.state]?.label||'']])));
    $('recent-list').replaceChildren(...recent.map(r=>li(TINT[r.state],[['ok',r.state==='completed'?'✓':r.state==='error'?'!':'‖'],['t',details&&r.title?r.title:'已结束的任务'],['s',`${short(r.ended-r.started)} · ${ago(r.ended)}`]])));
  }
  $('others').hidden=idle||!others.length;
  const t=history.today||{};
  $('today').hidden=!idle;
  $('today-count').textContent=String(t.count||0);$('today-time').textContent=duration(t.ms||0);
  const wallet=balance?.wallets?.find(w=>w.currency==='CNY')??balance?.wallets?.[0];
  $('third-tile').classList.toggle('money',!!wallet);
  if(wallet){
    const bonus=(balance.bonus||[]).filter(w=>w.currency===wallet.currency).reduce((n,w)=>n+Number(w.balance),0);
    const sign=wallet.currency==='USD'?'$':'¥';
    $('third-value').replaceChildren(document.createTextNode(sign+Number(wallet.balance).toFixed(2)));
    $('third-label').textContent=bonus>0?`余额 · 赠 ${sign}${bonus.toFixed(2)}`:'账户余额';
    $('third-tile').title=bonus>0?`另有赠送余额 ${sign}${bonus.toFixed(2)}`:'';
  }else{$('third-value').textContent=tokens(t.tokens||0);$('third-label').textContent='今日 tokens';}
  const day=history.day;
  $('usage').hidden=!idle||!day||!day.tokens;
  if(day&&day.tokens){
    const cost=history.today?.cost;
    $('usage-sum').textContent=`${tokens(day.tokens)} tokens${day.cacheRate!=null?` · 缓存命中 ${day.cacheRate}%`:''}${cost>=0.005?` · 今日≈¥${cost.toFixed(2)}`:''}`;
    const max=Math.max(...day.hours,1),key=day.hours.join(',');
    if($('usage-bars').dataset.key!==key){$('usage-bars').dataset.key=key;$('usage-bars').replaceChildren(...day.hours.map((v,i)=>{const b=document.createElement('i');if(!v)b.className='zero';b.style.height=v?`${Math.max(8,Math.round(v/max*100))}%`:'';b.style.animationDelay=`${i*18}ms`;b.title=`${tokens(v)} tokens`;return b;}));}
  }
  $('recent').hidden=!(idle||['completed','paused','error'].includes(state))||!recent.length;
  $('hint').hidden=!idle||preview;
  $('stop').hidden=!a.stoppable;if(!a.stoppable)disarm();
  const reply=details&&state==='completed'?d.reply:'';
  $('reply').hidden=!reply;$('reply-text').textContent=reply||'';
  if(reply)$('recent').hidden=true;
  const approving=renderApprove();
  if(approving)$('ask').hidden=true;
  const asking=!approving&&renderAsk();
  if(approving||asking)for(const id of ['task','others','today','usage','recent','hint','reply'])$(id).hidden=true;
}

// 状态切换：文字与指示器做模糊交叉淡入，异常时整体轻摇。
function choreograph(state,prev){
  if(!motionOn()||!prev)return;
  $('indicator').animate([{opacity:0,filter:'blur(5px)',scale:'.6'},{opacity:1,filter:'blur(0)',scale:'1'}],{duration:460,easing:'cubic-bezier(.22,1,.36,1)'});
  $('copy').animate([{opacity:0,filter:'blur(4px)',translate:'0 5px'},{opacity:1,filter:'blur(0)',translate:'0 0'}],{duration:380,easing:'cubic-bezier(.22,1,.36,1)'});
  if(state==='error')stage.animate([{translate:'0'},{translate:'-7px'},{translate:'6px'},{translate:'-4px'},{translate:'3px'},{translate:'-1px'},{translate:'0'}],{duration:520,easing:'ease-out'});
  if(state==='completed')stage.animate([{scale:'1'},{scale:'1.035'},{scale:'1'}],{duration:520,easing:'cubic-bezier(.22,1,.36,1)'});
}

function render(snapshot){
  if(!snapshot)return;
  current=snapshot;
  const {activity:a,settings:s,preview}=snapshot;
  const state=Object.hasOwn(STATES,a.state)?a.state:'offline',copy=STATES[state];
  document.body.dataset.position=s.position;document.body.dataset.motion=s.motion;
  island.dataset.state=state;island.dataset.preview=String(!!preview);

  $('status-label').textContent=copy.label;
  const details=snapshot.prefs?.details!==false;
  const ask=askOf(),approval=approvalOf(),reply=details&&state==='completed'?a.detail?.reply:'';
  if(ask&&state==='waiting')$('status-label').textContent='有问题等你回答';
  if(approval)$('status-label').textContent='需要你批准';
  else if(reply)$('status-label').textContent='有新回复';
  $('mini-note').textContent=approval&&!expanded?(details&&approval.detail?.text?approval.detail.text:toolLabel(approval.toolName))
    :ask&&state==='waiting'&&!expanded?ask.questions[0].question
    :reply&&!expanded?reply
    :state==='idle'?(preview?'动画预览':'DeepSeek Harness'):details&&a.title?a.title:copy.detail;
  island.dataset.alert=approval?'approval':reply?'reply':'';
  renderRing(state,a.detail);
  $('badge').hidden=!(a.activeCount>1);$('badge').textContent=a.activeCount>1?String(a.activeCount):'';
  $('demo-controls').hidden=!preview;$('demo-state').value=state;
  renderPanel(snapshot);

  for(const id of drafts.keys())if(!(a.questions||[]).some(q=>q.callId===id))drafts.delete(id);
  for(const id of [...seenApproval.keys()])if(!(a.approvals||[]).some(x=>x.id===id)){seenApproval.delete(id);sentApproval.delete(id);}
  const prompt=approval?'approval:'+approval.id:ask?'ask:'+ask.callId:'';
  if(prompt&&!seenAsk.has(prompt)){seenAsk.add(prompt);if(snapshot.prefs?.popups!==false&&!expanded){autoOpened=true;expand(true);}}
  if(!prompt&&autoOpened){autoOpened=false;if(expanded)expand(false);}
  // 新回复：完成时在胶囊里预览回复开头，并多停留一会儿。
  if(reply&&reply!==lastReply&&lastState===state&&!expanded&&snapshot.prefs?.popups!==false)burst(4200);
  lastReply=reply||'';
  if(lastState!==state){
    const prev=lastState;lastState=state;
    $('announcement').textContent=copy.label;
    choreograph(state,prev);
    const fresh=state!=='thinking'||QUIET.includes(prev);
    if(BURST[state]&&fresh&&prev&&!expanded&&snapshot.prefs?.popups!==false)burst(reply?4200:BURST[state]);
  }
  // 切到减少动效时，正在进行的过渡直接落到终点。
  if(!motionOn())document.getAnimations().forEach(x=>{if(x instanceof CSSAnimation)return;try{x.finish();}catch{x.cancel();}});
  tick();applyShape();trackTransition();
}

const unsubscribe=bridge.subscribe(render);
render(await bridge.initial());
const timer=setInterval(tick,1000);
window.addEventListener('beforeunload',()=>{unsubscribe();clearInterval(timer);cancelAnimationFrame(boundsFrame);clearTimeout(burstTimer);clearTimeout(peekTimer);clearTimeout(leaveTimer);clearTimeout(armTimer);clearTimeout(hoverTimer);});
