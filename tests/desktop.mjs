import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {runtimePath} from '../src/runtime.js';
const require=createRequire(process.env.DSH_TEST_DEPS?resolve(process.env.DSH_TEST_DEPS,'../package.json'):new URL('../package.json',import.meta.url));
const {_electron}=require('playwright');
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
await mkdir('artifacts/qa',{recursive:true});await mkdir('.work/qa-profile',{recursive:true});
await writeFile('.work/qa-profile/settings.json',JSON.stringify({position:'top-center',scale:1,motion:'full',enabled:true}));
const app=await _electron.launch({executablePath:runtimePath(),args:[resolve('desktop/main.cjs'),'--preview',`--island-data=${resolve('.work/qa-profile')}`],env,timeout:30000});
const errors=[];
try{
  const page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));
  await page.waitForFunction(()=>window.island&&document.getElementById('status-label').textContent==='随时待命');
  await page.waitForTimeout(950);
  const windowState=await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];return{top:w.isAlwaysOnTop(),bounds:w.getBounds(),background:w.getBackgroundColor()};});
  assert.equal(windowState.top,true);
  await page.screenshot({path:'artifacts/qa/01-idle.png',omitBackground:true});
  // Browser events target the same isolated preload used by real clicks.
  await page.locator('#capsule').click();await page.waitForTimeout(800);
  assert.equal(await page.locator('#capsule').getAttribute('aria-expanded'),'true');
  await page.screenshot({path:'artifacts/qa/02-panel.png',omitBackground:true});
  const panelFits=await page.evaluate(()=>document.getElementById('demo-controls').getBoundingClientRect().bottom<=document.getElementById('island').getBoundingClientRect().bottom-8);
  assert.ok(panelFits,'expanded panel is not clipped');
  // Position, size and motion come from Harness settings; the preview drives the same window through its bridge.
  const settings=value=>page.evaluate(v=>window.island.settings(v),value);
  for(const position of ['left-center','right-center','bottom-center','top-center']){
    await settings({position});await page.waitForTimeout(800);
    assert.equal(await page.locator('body').getAttribute('data-position'),position);
    assert.equal(await page.locator('#island').getAttribute('data-layout'),['left-center','right-center'].includes(position)?'v':'h');
    const box=await page.locator('#island').boundingBox(),size=await page.evaluate(()=>({w:innerWidth,h:innerHeight}));
    assert.ok(box.x>=0&&box.y>=0&&box.x+box.width<=size.w+1&&box.y+box.height<=size.h+1,`${position} stays visible`);
  }
  for(const scale of [0.85,1.15,1]){
    await settings({scale});await page.waitForTimeout(600);
    assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.getZoomFactor()),scale);
  }
  const states=['thinking','streaming','tools','waiting','completed','paused','error','reconnecting','compacting','offline'];
  for(const state of states){
    await page.selectOption('#demo-state',state);await page.waitForTimeout(700);
    assert.equal(await page.locator('#island').getAttribute('data-state'),state);
    await page.screenshot({path:`artifacts/qa/state-${state}.png`,omitBackground:true});
  }
  // Answering a question in the island: pick, next, multi-pick, submit; the preview then resumes thinking.
  // A permission request comes first: the buttons unlock after a moment, allowing once hands over to the question.
  await page.selectOption('#demo-state','waiting');await page.waitForTimeout(300);
  assert.equal(await page.locator('#approve').isVisible(),true);assert.equal(await page.locator('#ask').isVisible(),false);
  assert.equal(await page.locator('#approve-allow').isDisabled(),true,'approval buttons are locked briefly against stray clicks');
  await page.waitForTimeout(700);await page.screenshot({path:'artifacts/qa/approval.png',omitBackground:true});
  await page.click('#approve-allow');await page.waitForTimeout(500);
  assert.equal(await page.locator('#ask').isVisible(),true);
  await page.click('.ask-opt >> nth=0');await page.click('#ask-next');await page.waitForTimeout(300);
  await page.click('.ask-opt >> nth=1');await page.click('#ask-next');await page.waitForTimeout(1200);
  assert.equal(await page.locator('#island').getAttribute('data-state'),'thinking');
  await page.screenshot({path:'artifacts/qa/ask-answered.png',omitBackground:true});
  // Stop needs two clicks; the preview answers by pausing its sample task.
  await page.selectOption('#demo-state','tools');await page.waitForTimeout(700);
  assert.equal(await page.locator('#stop').isVisible(),true);
  await page.click('#stop');assert.equal(await page.getAttribute('#stop','data-armed'),'true');
  await page.click('#stop');await page.waitForTimeout(700);
  assert.equal(await page.locator('#island').getAttribute('data-state'),'paused');
  // Completed tasks preview the reply; the usage window opens from the panel.
  await page.selectOption('#demo-state','completed');await page.waitForTimeout(700);
  assert.equal(await page.locator('#reply').isVisible(),true);
  const [stats]=await Promise.all([app.waitForEvent('window'),page.click('#stats')]);
  await stats.waitForFunction(()=>/^\d/.test(document.getElementById('k-turns').textContent));
  await stats.click('[data-range="7d"]');await stats.waitForFunction(()=>document.getElementById('chart-title').textContent.includes('7'));
  assert.equal(await stats.locator('.chart .col').count(),7);
  await stats.screenshot({path:'artifacts/qa/stats.png'});await stats.close();
  await settings({motion:'reduced'});await page.waitForTimeout(250);
  const activeAnimations=await page.evaluate(()=>document.getAnimations().filter(a=>a.playState==='running').length);assert.equal(activeAnimations,0);
  await settings({motion:'full'});await page.waitForTimeout(250);await page.keyboard.press('Escape');await page.waitForTimeout(750);
  assert.equal(await page.locator('#capsule').getAttribute('aria-expanded'),'false');
  assert.equal(await page.$eval('#panel',e=>e.inert),true);
  if(process.platform==='win32'){
    const points=await app.evaluate(async({BrowserWindow,screen})=>{
      const w=BrowserWindow.getAllWindows()[0],bounds=w.getBounds();
      const behind=new BrowserWindow({...bounds,show:false,frame:false,webPreferences:{contextIsolation:true,nodeIntegration:false}});
      await behind.loadURL('data:text/html,<body style="background:%23f0f4ff">Island input test<script>window.clicks=0;document.onclick=()=>window.clicks++</script>');
      behind.show();w.moveTop();
      const native=(x,y)=>screen.dipToScreenPoint({x:bounds.x+x,y:bounds.y+y});
      return {behind:behind.id,original:screen.dipToScreenPoint(screen.getCursorScreenPoint()),empty:native(30,200),capsule:native(220,30)};
    });
    const pointer=(p,click)=>execFileSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',resolve('tests/native-pointer.ps1'),'-X',String(p.x),'-Y',String(p.y),...(click?['-Click']:[])],{windowsHide:true});
    try{
      pointer(points.empty,true);await page.waitForTimeout(200);
      assert.equal(await app.evaluate(async({BrowserWindow},id)=>BrowserWindow.fromId(id).webContents.executeJavaScript('window.clicks'),points.behind),1,'transparent area lets real OS click reach the underlying window');
      pointer(points.capsule,true);await page.waitForTimeout(800);
      assert.equal(await page.locator('#capsule').getAttribute('aria-expanded'),'true','visible capsule receives real OS click');
      assert.equal(await app.evaluate(async({BrowserWindow},id)=>BrowserWindow.fromId(id).webContents.executeJavaScript('window.clicks'),points.behind),1,'capsule click is not sent through');
    }finally{pointer(points.original,false);await app.evaluate(({BrowserWindow},id)=>BrowserWindow.fromId(id)?.destroy(),points.behind);}
  }
  assert.deepEqual(errors,[]);
  console.log('PASS native transparent window, always-on-top, four anchors, vertical side layout, three sizes, two-step stop, approvals, answering questions, reply preview, usage window, all 11 states, reduced motion, Escape, native click-through and renderer errors');
  await writeFile('artifacts/qa/desktop-result.json',JSON.stringify({passed:true,windowState,states:['idle',...states],errors},null,2));
}finally{await app.close();}
