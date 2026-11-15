const assert=require('node:assert/strict');
const {createRequire}=require('node:module');
const path=require('node:path');
const os=require('node:os');
const fs=require('node:fs');
const {pathToFileURL}=require('node:url');

// 运行环境缺失时 apply() 不能崩、也不能把原因吞掉：写状态文件供设置页/用户查看。
async function checkMissingRuntime(Context){
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'dsh-island-home-'));
  const savedHome=process.env.DSH_HOME, savedElectron=process.env.DSH_ISLAND_ELECTRON, savedPrompt=process.env.DSH_ISLAND_NO_PROMPT;
  process.env.DSH_HOME=home; delete process.env.DSH_ISLAND_ELECTRON; process.env.DSH_ISLAND_NO_PROMPT='1';
  const {apply}=await import(pathToFileURL(path.join(__dirname,'../src/host.js')));
  const root=new Context(); let ctx;
  const owner=root.plugin(c=>{ctx=c;}); await owner.await();
  ctx.provide('agents',{list:()=>[],roots:()=>[],get:()=>undefined});
  try{
    const fiber=root.plugin({ inject:['agents'], apply(c){ apply(c,{}); } });
    await fiber.await();
    const statusFile=path.join(home,'dsh-island','runtime-status.json');
    for(let i=0;i<100&&!fs.existsSync(statusFile);i++)await new Promise(resolve=>setTimeout(resolve,20));
    assert.ok(fs.existsSync(statusFile),'a missing runtime leaves a diagnosable status file');
    const status=JSON.parse(fs.readFileSync(statusFile,'utf8'));
    assert.equal(status.state,'missing');
    assert.match(status.reason,/运行环境/);
    assert.ok(Array.isArray(status.tried)&&status.tried.length>0,'the paths it looked at are recorded');
    assert.ok(fs.existsSync(path.join(home,'dsh-island','runtime-help.txt')),'the fix is written down for the user');
    console.log('PASS missing desktop runtime is reported instead of swallowed');
  }finally{
    await owner.dispose();
    if(savedHome===undefined)delete process.env.DSH_HOME;else process.env.DSH_HOME=savedHome;
    if(savedElectron===undefined)delete process.env.DSH_ISLAND_ELECTRON;else process.env.DSH_ISLAND_ELECTRON=savedElectron;
    if(savedPrompt===undefined)delete process.env.DSH_ISLAND_NO_PROMPT;else process.env.DSH_ISLAND_NO_PROMPT=savedPrompt;
  }
}

async function main(){
  const req=createRequire(process.env.DSH_HOST_PACKAGE||'D:/deepseek harness/resources/app.asar/dsh/package.json');
  const manifest=require('../package.json');
  const {evaluatePluginCompatibility}=req('@deepseek-ai/dsh-app-boot');
  const {satisfies}=req('semver');
  assert.equal(evaluatePluginCompatibility(manifest),undefined);
  assert.equal(satisfies(req('./package.json').version,manifest.peerDependencies['@deepseek-ai/dsh'],{includePrerelease:true}),true);
  const {Context}=req('@deepseek-ai/cordis');
  const {attachActivity}=await import(pathToFileURL(path.join(__dirname,'../src/host.js')));
  const {ActivityStore}=await import(pathToFileURL(path.join(__dirname,'../src/state.js')));
  const root=new Context();let ctx;const owner=root.plugin(c=>{ctx=c;});await owner.await();
  ctx.provide('agents',{list:()=>[]});
  const s=new ActivityStore();let updates=0;const detach=attachActivity(ctx,s,()=>updates++);
  const session={id:'host-contract'},agent={session};
  try{
    await ctx.parallel('session/event',session,{type:'turn/start',data:{turn:1}});
    assert.equal(s.snapshot().state,'thinking');
    await ctx.parallel('agent/assistant-stream',{agent,frame:{type:'chunk',chunk:{type:'text-delta',text:'x'}}});
    assert.equal(s.snapshot().state,'streaming');
    await ctx.parallel('session/event',session,{type:'approval/asked',data:{id:'p'}});
    assert.equal(s.snapshot().state,'waiting');
    await ctx.parallel('session/event',session,{type:'turn/end',data:{reason:{kind:'completed'}}});
    assert.equal(s.snapshot().state,'completed');
    detach();const before=updates;await ctx.parallel('agent/error',{agent,error:new Error('synthetic')});assert.equal(updates,before);
    console.log('PASS installed Harness '+manifest.peerDependencies['@deepseek-ai/dsh']+' compatibility, real Cordis event dispatch and listener cleanup');
  }finally{await owner.dispose();}
  await checkMissingRuntime(Context);
}
main().catch(e=>{console.error(e);process.exitCode=1;});
