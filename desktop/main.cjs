const { app, BrowserWindow, ipcMain, screen, Menu, Tray, nativeImage, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const demo = process.argv.includes('--preview');
const dataArg = process.argv.find(v=>v.startsWith('--island-data='));
const dataDir = dataArg ? dataArg.slice('--island-data='.length) : path.join(app.getPath('userData'),'dsh-island');
app.setPath('userData',dataDir);
app.setName('DeepSeek Island');
const single = app.requestSingleInstanceLock();
if(!single) app.quit();
else start().catch(error=>{ console.error(error); app.exit(1); });

const WIDTH = 440, HEIGHT = 460;
const SIZES = { small: 0.85, medium: 1, large: 1.15 };
const DAY = 24 * 3600 * 1000;

async function start() {
  const {normalizeSettings,windowBounds,containsPoint,POSITIONS}=await import(pathToFileURL(path.join(__dirname,'../src/geometry.js')));
  const {STATES}=await import(pathToFileURL(path.join(__dirname,'../src/state.js')));
  const read=(file,fallback)=>{ try { return JSON.parse(fs.readFileSync(path.join(dataDir,file),'utf8')); } catch { return fallback; } };
  const write=(file,value)=>{
    fs.mkdirSync(dataDir,{recursive:true});
    const target=path.join(dataDir,file);
    fs.writeFileSync(target+'.tmp',JSON.stringify(value,null,2));
    fs.renameSync(target+'.tmp',target);
  };
  // 本地只保存“是否隐藏”和显示器；位置、大小、动效来自 Harness 设置（预览模式下才在本地保存）。
  let settings=normalizeSettings(read('settings.json',{}));
  let prefs={enabled:true,popups:true,details:true,balance:true,questions:true,approvals:true,hoverExpand:true};
  let balance=null;
  let answerResults={},approvalResults={};
  let statsWin=null,statsRange='today';
  let history=Array.isArray(read('history.json',[]))?read('history.json',[]):[];
  let win, tray, ignore=true, hitbox=null, quitting=false, activity={state:'idle',activeCount:0}, demoTimer;
  const save=()=>write('settings.json',settings);
  const visible=()=>settings.enabled&&prefs.enabled;

  // 完成记录：只记标题、结果、时长、工具次数与输出量，用于“今天”和“最近完成”。
  const remember=finished=>{
    let changed=false;
    for(const f of finished??[]){
      const key=`${f.id}:${f.ended}`;
      if(!f.ended||history.some(h=>h.key===key))continue;
      history.push({key,title:String(f.title||'').slice(0,100),state:f.state,started:f.started,ended:f.ended,toolCount:f.toolCount||0,inputTokens:f.inputTokens||0,cacheTokens:f.cacheTokens||0,outputTokens:f.outputTokens||0});
      changed=true;
    }
    if(!changed)return;
    history=history.filter(h=>Date.now()-h.ended<7*DAY).slice(-60);
    try{write('history.json',history);}catch{}
  };
  const summary=()=>{
    const now=Date.now(),midnight=new Date();midnight.setHours(0,0,0,0);
    const today=history.filter(h=>h.ended>=midnight.getTime());
    const total=h=>(h.inputTokens||0)+(h.cacheTokens||0)+(h.outputTokens||0);
    // 过去 24 小时，每小时一根柱（按任务结束时间计）。
    const hours=Array.from({length:24},()=>0);
    for(const h of history){const age=now-h.ended;if(age>=0&&age<DAY)hours[23-Math.floor(age/3600e3)]+=total(h);}
    const day=history.filter(h=>now-h.ended<DAY),input=day.reduce((n,h)=>n+(h.inputTokens||0),0),cache=day.reduce((n,h)=>n+(h.cacheTokens||0),0);
    return {
      recent:history.slice(-4).reverse(),
      today:{count:today.filter(h=>h.state==='completed').length,runs:today.length,ms:today.reduce((n,h)=>n+Math.max(0,h.ended-h.started),0),outputTokens:today.reduce((n,h)=>n+(h.outputTokens||0),0),tokens:today.reduce((n,h)=>n+total(h),0)},
      day:{hours,tokens:hours.reduce((a,b)=>a+b,0),cacheRate:input+cache>0?Math.round(cache/(input+cache)*100):null}
    };
  };
  // Harness 侧的用量账本（含历史会话补算）优先；没有时退回本地的完成记录。
  const payload=()=>({activity,settings,prefs,answerResults,approvalResults,balance:prefs.balance?balance:null,preview:demo,history:activity.usage??summary(),displays:screen.getAllDisplays().map((d,i)=>({id:d.id,label:d.label||`显示器 ${i+1}`}))});
  const send=()=>{ if(win && !win.isDestroyed())win.webContents.send('island:snapshot',payload()); };
  const position=()=>{
    const display=screen.getAllDisplays().find(d=>d.id===settings.displayId)||screen.getPrimaryDisplay();
    win.webContents.setZoomFactor(settings.scale);
    win.setBounds(windowBounds(display.workArea,settings,WIDTH,HEIGHT));
    hitbox=null; send();
  };
  const sync=()=>{ position(); if(visible())win.showInactive(); else win.hide(); send(); };
  const show=()=>{settings.enabled=true;save();sync();};
  const hide=()=>{settings.enabled=false;save();sync();};
  const update=value=>{settings=normalizeSettings({...settings,...value});save();sync();};
  const applyPrefs=value=>{
    if(!value||typeof value!=='object')return;
    prefs={enabled:value.enabled!==false,popups:value.popups!==false,details:value.details!==false,balance:value.balance!==false,questions:value.questions!==false,approvals:value.approvals!==false,hoverExpand:value.hoverExpand!==false};
    settings=normalizeSettings({...settings,position:value.position,scale:SIZES[value.size]??1,motion:value.reduceMotion?'reduced':'full'});
    save();sync();
  };
  const openHarness=()=>shell.openExternal('dsh://open').catch(()=>{});
  // 用量统计窗口：数据由 Harness 侧的用量账本按需计算（预览模式用示例数据）。
  const requestStats=range=>{
    statsRange=['today','7d','30d'].includes(range)?range:statsRange;
    if(demo){const data=demoStats(statsRange);setTimeout(()=>statsWin?.webContents.send('stats:data',data),120);return;}
    if(process.send)process.send({type:'stats',range:statsRange});
    else statsWin?.webContents.send('stats:data',null);
  };
  const openStats=()=>{
    if(statsWin&&!statsWin.isDestroyed()){statsWin.show();statsWin.focus();requestStats(statsRange);return;}
    statsWin=new BrowserWindow({width:860,height:680,minWidth:620,minHeight:480,show:false,title:'用量统计 · DeepSeek 灵动岛',backgroundColor:'#0b0e17',autoHideMenuBar:true,
      webPreferences:{preload:path.join(__dirname,'stats-preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
    statsWin.setMenuBarVisibility(false);
    statsWin.webContents.setWindowOpenHandler(({url})=>{if(/^https:\/\/api-docs\.deepseek\.com\//.test(url))shell.openExternal(url).catch(()=>{});return {action:'deny'};});
    statsWin.webContents.on('will-navigate',event=>event.preventDefault());
    statsWin.once('ready-to-show',()=>statsWin.show());
    statsWin.on('closed',()=>{statsWin=null;});
    statsWin.loadFile(path.join(__dirname,'stats.html'),{query:{preview:demo?'1':''}});
  };
  const menu=()=>Menu.buildFromTemplate([
    {label:visible()?'隐藏灵动岛':'显示灵动岛',click:()=>visible()?hide():show()},
    {label:'显示器',submenu:screen.getAllDisplays().map((d,i)=>({label:d.label||`显示器 ${i+1}`,type:'radio',checked:(settings.displayId??screen.getPrimaryDisplay().id)===d.id,click:()=>update({displayId:d.id})}))},
    ...(demo?[
      {label:'停靠位置',submenu:Object.entries(POSITIONS).map(([id,label])=>({label,type:'radio',checked:settings.position===id,click:()=>update({position:id})}))},
      {label:'大小',submenu:[[.85,'小巧'],[1,'适中'],[1.15,'舒展']].map(([scale,label])=>({label,type:'radio',checked:settings.scale===scale,click:()=>update({scale})}))},
      {label:'减少动态效果',type:'checkbox',checked:settings.motion==='reduced',click:()=>update({motion:settings.motion==='full'?'reduced':'full'})},
      {label:'播放全部状态',click:()=>playDemo()}
    ]:[{label:'位置与大小：Harness 设置 › 灵动岛',click:openHarness}]),
    {type:'separator'},
    {label:'用量统计',click:openStats},
    {label:'打开 DeepSeek Harness',click:openHarness},
    {label:'退出灵动岛',click:()=>app.quit()}
  ]);
  await app.whenReady();
  win=new BrowserWindow({width:WIDTH,height:HEIGHT,show:false,frame:false,transparent:true,backgroundColor:'#00000000',hasShadow:false,alwaysOnTop:true,skipTaskbar:true,resizable:false,maximizable:false,minimizable:false,fullscreenable:false,title:'DeepSeek 灵动岛',webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:true}});
  win.setAlwaysOnTop(true,'floating');
  win.setIgnoreMouseEvents(true,{forward:true});
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  win.webContents.on('will-navigate',event=>event.preventDefault());
  const trusted=event=>event.sender===win.webContents && event.senderFrame===win.webContents.mainFrame;
  ipcMain.handle('island:initial',event=>trusted(event)?payload():null);
  ipcMain.on('island:settings',(event,value)=>{if(trusted(event)&&value&&typeof value==='object'&&demo)update(value);});
  ipcMain.on('island:bounds',(event,rect)=>{
    if(!trusted(event)||!rect||!['x','y','width','height'].every(k=>Number.isFinite(rect[k])))return;
    hitbox={x:Math.max(0,rect.x),y:Math.max(0,rect.y),width:Math.min(WIDTH,Math.max(0,rect.width)),height:Math.min(HEIGHT,Math.max(0,rect.height)),radius:Number.isFinite(rect.radius)?Math.max(0,rect.radius):0};
  });
  ipcMain.on('island:menu',event=>{if(trusted(event))menu().popup({window:win});});
  ipcMain.on('island:open',event=>{if(trusted(event))openHarness();});
  ipcMain.on('island:hide',event=>{if(trusted(event))hide();});
  ipcMain.on('island:answer',(event,callId,answers)=>{
    if(!trusted(event)||typeof callId!=='string'||!Array.isArray(answers)||answers.length>8)return;
    if(!(activity.questions||[]).some(q=>q.callId===callId))return;
    const clean=answers.map(a=>({id:String(a?.id??''),selected:Array.isArray(a?.selected)?a.selected.filter(x=>typeof x==='string').slice(0,8):[],...(typeof a?.custom==='string'&&a.custom.trim()?{custom:a.custom.slice(0,4000)}:{})}));
    if(demo){answerResults={[callId]:{ok:true,at:Date.now()}};send();setTimeout(()=>setDemoState('thinking'),700);return;}
    if(process.send)process.send({type:'answer',callId,answers:clean});
  });
  ipcMain.on('island:panel',event=>{if(trusted(event)&&process.send)process.send({type:'panel-open'});});
  ipcMain.on('island:stats',event=>{if(trusted(event))openStats();});
  ipcMain.on('stats:request',(event,range)=>{if(statsWin&&event.sender===statsWin.webContents&&event.senderFrame===statsWin.webContents.mainFrame)requestStats(range);});
  ipcMain.on('island:approve',(event,id,outcome)=>{
    if(!trusted(event)||typeof id!=='string'||!['allowed-once','rejected'].includes(outcome))return;
    if(!(activity.approvals||[]).some(a=>a.id===id))return;
    if(demo){approvalResults={[id]:{ok:true,at:Date.now()}};activity={...activity,approvals:activity.approvals.filter(a=>a.id!==id)};send();return;}
    if(process.send)process.send({type:'approve',id,outcome});
  });
  ipcMain.on('island:stop',(event,sessionId)=>{
    if(!trusted(event)||typeof sessionId!=='string'||sessionId!==activity.sessionId||!activity.stoppable)return;
    if(demo){setDemoState('paused');return;}
    if(process.send)process.send({type:'stop',sessionId});
  });
  ipcMain.on('island:preview',(event,state)=>{
    if(!demo||!trusted(event)||!Object.hasOwn(STATES,state))return;
    clearInterval(demoTimer);setDemoState(state);
  });
  // 预览用的示例数据，标明“动画预览”，不代表实际任务。
  const setDemoState=state=>{
    const done=['idle','completed','paused','error','offline'].includes(state);
    const busy=!done;
    activity={state,title:'重构登录模块并补齐测试',sessionId:'preview',activeCount:busy?2:0,started:Date.now()-192000,ended:done?Date.now():0,
      tool:state==='tools'?'str_replace_editor':'',stoppable:busy&&state!=='offline',
      detail:state==='idle'?null:{plan:{total:7,done:state==='completed'?7:4,current:state==='completed'?'':'补齐登录失败场景的单元测试'},trail:['read','grep','str_replace_editor','bash'],toolCount:23,model:'deepseek-v4-pro',contextTokens:state==='compacting'?968000:412000,contextWindow:1048576,outputTokens:8210,cacheRate:94,...(state==='completed'?{reply:'登录模块已拆成 3 个文件，新增 14 个单元测试全部通过。验证码过期场景需要后端配合，我在 TODO 里留了说明。'}:{})},
      sessions:busy?[{id:'preview',title:'重构登录模块并补齐测试',state,started:Date.now()-192000},{id:'p2',title:'整理周报数据',state:'streaming',started:Date.now()-41000}]:[],
      questions:state==='waiting'?[{callId:'demo-ask',sessionId:'preview',state:'open',title:'重构登录模块并补齐测试',questions:[
        {id:'framework',header:'测试框架',question:'登录模块的单元测试用哪个框架？',multiSelect:false,options:[{label:'Vitest',description:'和现有构建工具一致，速度快'},{label:'Jest',description:'生态成熟，迁移成本略高'},{label:'node:test',description:'零依赖'}]},
        {id:'cases',header:'覆盖场景',question:'需要覆盖哪些失败场景？',multiSelect:true,options:[{label:'密码错误'},{label:'账号锁定'},{label:'验证码过期'}]}]}]:[],
      approvals:state==='waiting'?[{id:'demo-approval',sessionId:'preview',title:'重构登录模块并补齐测试',at:Date.now(),toolName:'bash',reason:'运行测试需要执行命令',detail:{label:'命令',text:'npm test -- --coverage src/auth',mono:true}}]:[],
      finished:[]};
    if(demo&&!history.length){
      const sample=[['修复首页加载白屏','completed',22,312,18],['写一份竞品对比表','completed',17,146,9],['整理接口文档','completed',9,205,14],['升级依赖并跑测试','error',3,88,6],['生成周报图表','completed',1.5,131,11]];
      history=sample.map(([title,st,hoursAgo,secs,tools],i)=>{const ended=Date.now()-hoursAgo*3600e3;return {key:'demo'+i,title,state:st,started:ended-secs*1000,ended,toolCount:tools,inputTokens:9000+i*2100,cacheTokens:180000+i*41000,outputTokens:5200+i*1300};});
      balance={wallets:[{currency:'CNY',balance:'48.62'}],bonus:[{currency:'CNY',balance:'10.00'}],at:Date.now()};
    }
    send();
  };
  const demoStats=range=>{
    const days=range==='30d'?30:range==='7d'?7:1,byHour=range==='today',start=new Date();start.setHours(0,0,0,0);start.setDate(start.getDate()-(days-1));
    const from=start.getTime(),n=byHour?24:days,nowH=new Date().getHours();
    const wave=i=>byHour?(i<=nowH&&i>=Math.min(9,Math.max(0,nowH-6))?0.4+Math.abs(Math.sin(i*1.7)):0):(0.3+Math.abs(Math.sin(i*2.1))*(i%7===5||i%7===6?0.3:1));
    const buckets=Array.from({length:n},(_,i)=>{const w=wave(i),d=new Date(from);if(byHour)d.setHours(i);else d.setDate(d.getDate()+i);
      const cacheRead=Math.round(w*(byHour?380000:2.6e6)),input=Math.round(w*(byHour?21000:150000)),output=Math.round(w*(byHour?9000:64000));
      return {start:d.getTime(),label:byHour?`${i}:00`:`${d.getMonth()+1}/${d.getDate()}`,cacheRead,input,output,cost:(cacheRead*0.02+input*1+output*4)/1e6*(i%3?1:2.2),turns:w?Math.max(1,Math.round(w*(byHour?3:14))):0};});
    const sum=k=>buckets.reduce((a,b)=>a+b[k],0),tokens=sum('cacheRead')+sum('input')+sum('output');
    const titles=['重构登录模块并补齐测试','整理周报数据','修复首页加载白屏','写一份竞品对比表','整理接口文档','升级依赖并跑测试'];
    const sessions=titles.slice(0,byHour?4:6).map((title,i)=>{const share=[.38,.22,.16,.11,.08,.05][i],turns=Math.max(1,Math.round(sum('turns')*share)),last=Date.now()-i*(byHour?3600e3:86400e3*days/7);
      const items=Array.from({length:Math.min(turns,8)},(_,k)=>{const end=last-k*1500e3,inp=9000+k*700,cr=120000+k*9000,out=3800+k*300,model=i===0&&k<2?'deepseek-v4-pro':'deepseek-flash';
        return {turn:turns-k,start:end-(120+k*40)*1000,end,state:k===2&&i===3?'error':'completed',model,calls:3+k%4,tools:5+k%6,input:inp,cacheRead:cr,output:out,cost:model==='deepseek-flash'?(inp+cr*0.02+out*4)/1e6:(inp*4.5+cr*0.15+out*13.5)/1e6,priced:true};});
      return {id:'demo'+i,title,tokens:Math.round(tokens*share),cost:sum('cost')*share,turns,last,items};});
    return {range,from,to:Date.now(),byHour,buckets,preview:true,
      totals:{tokens,input:sum('input'),cacheRead:sum('cacheRead'),output:sum('output'),cost:sum('cost'),unpricedTokens:0,turns:sum('turns'),completed:Math.round(sum('turns')*.93),ms:sum('turns')*184000,cacheRate:tokens?Math.round(sum('cacheRead')/(sum('cacheRead')+sum('input'))*100):null},
      models:[{model:'deepseek-flash',priced:true,tokens:Math.round(tokens*.78),cost:sum('cost')*.46,turns:Math.round(sum('turns')*.8)},{model:'deepseek-v4-pro',priced:true,tokens:Math.round(tokens*.22),cost:sum('cost')*.54,turns:Math.round(sum('turns')*.2)}],
      sessions,scanned:42};
  };
  const playDemo=()=>{clearInterval(demoTimer);let i=0;const order=['idle','thinking','streaming','tools','waiting','completed','paused','error','reconnecting','compacting','offline'];setDemoState(order[i++]);demoTimer=setInterval(()=>setDemoState(order[i++%order.length]),4500);};
  process.on('message',message=>{
    if(message?.type==='shutdown')app.quit();
    if(message?.type==='prefs')applyPrefs(message.data);
    if(message?.type==='show')show();
    if(message?.type==='answer-result'&&typeof message.callId==='string'){answerResults={...Object.fromEntries(Object.entries(answerResults).filter(([,r])=>Date.now()-r.at<300000)),[message.callId]:{ok:!!message.ok,reason:String(message.reason||'').slice(0,80),at:Date.now()}};send();}
    if(message?.type==='approval-result'&&typeof message.id==='string'){approvalResults={...Object.fromEntries(Object.entries(approvalResults).filter(([,r])=>Date.now()-r.at<300000)),[message.id]:{ok:!!message.ok,reason:String(message.reason||'').slice(0,80),at:Date.now()}};send();}
    if(message?.type==='stats'&&statsWin&&!statsWin.isDestroyed())statsWin.webContents.send('stats:data',message.data??null);
    if(message?.type==='balance'){balance=message.data&&Array.isArray(message.data.wallets)?message.data:null;send();}
    if(message?.type==='activity'&&Object.hasOwn(STATES,message.data?.state)){activity=message.data;remember(activity.finished);send();}
  });
  // Losing the owning Harness process cannot leave an orphan overlay behind.
  if(process.send) process.on('disconnect',()=>app.quit());
  await win.loadFile(path.join(__dirname,'index.html'));
  position();
  if(visible())win.showInactive();
  const image = await win.webContents.executeJavaScript(`new Promise(resolve=>{const img=new Image();img.onload=()=>{const c=document.createElement('canvas');c.width=c.height=32;const x=c.getContext('2d');x.drawImage(img,0,0,32,32);x.globalCompositeOperation='source-in';x.fillStyle='#4d6bfe';x.fillRect(0,0,32,32);resolve(c.toDataURL())};img.onerror=()=>resolve('');img.src='../assets/deepseek.svg'})`);
  tray=new Tray(image?nativeImage.createFromDataURL(image):nativeImage.createEmpty());
  tray.setToolTip(demo?'DeepSeek 灵动岛 · 动画预览':'DeepSeek 灵动岛');
  tray.on('click',()=>visible()?hide():show());
  tray.on('right-click',()=>tray.popUpContextMenu(menu()));
  const cursorTimer=setInterval(()=>{
    if(!win.isVisible()||!hitbox)return;
    const p=screen.getCursorScreenPoint(),b=win.getBounds(),s=settings.scale;
    const x=(p.x-b.x)/s,y=(p.y-b.y)/s;
    const next=!containsPoint(hitbox,x,y);
    if(ignore!==next){ignore=next;win.setIgnoreMouseEvents(next,{forward:true});}
  },40);
  screen.on('display-metrics-changed',position); screen.on('display-removed',position);screen.on('display-added',position);
  app.on('second-instance',show);
  win.on('close',event=>{if(!quitting){event.preventDefault();hide();}});
  app.on('before-quit',()=>{quitting=true;statsWin?.destroy();clearInterval(cursorTimer);clearInterval(demoTimer);tray?.destroy();});
  if(process.send) process.send({type:'ready'});
  if(demo && process.argv.includes('--cycle'))playDemo();
  if(process.argv.includes('--stats'))openStats();
}
