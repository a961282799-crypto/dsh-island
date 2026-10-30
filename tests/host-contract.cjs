const assert=require('node:assert/strict');
const {createRequire}=require('node:module');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
async function main(){
  const req=createRequire(process.env.DSH_HOST_PACKAGE||'D:/deepseek harness/resources/app.asar/dsh/package.json');
  const manifest=require('../package.json');
  const {evaluatePluginCompatibility}=req('@deepseek-ai/dsh-app-boot');
  assert.equal(req('./package.json').version,manifest.peerDependencies['@deepseek-ai/dsh']);
  assert.equal(evaluatePluginCompatibility(manifest),undefined);
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
}
main().catch(e=>{console.error(e);process.exitCode=1;});
