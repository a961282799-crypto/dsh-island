const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('island',{
  initial:()=>ipcRenderer.invoke('island:initial'),
  subscribe:callback=>{const fn=(_event,data)=>callback(data);ipcRenderer.on('island:snapshot',fn);return()=>ipcRenderer.removeListener('island:snapshot',fn);},
  onBlur:callback=>{const fn=()=>callback();ipcRenderer.on('island:blur',fn);return()=>ipcRenderer.removeListener('island:blur',fn);},
  engage:()=>ipcRenderer.send('island:engage'),
  settings:value=>ipcRenderer.send('island:settings',value),
  bounds:value=>ipcRenderer.send('island:bounds',value),
  menu:()=>ipcRenderer.send('island:menu'),
  open:()=>ipcRenderer.send('island:open'),
  hide:()=>ipcRenderer.send('island:hide'),
  stop:sessionId=>ipcRenderer.send('island:stop',sessionId),
  panel:()=>ipcRenderer.send('island:panel'),
  answer:(callId,answers)=>ipcRenderer.send('island:answer',callId,answers),
  approve:(id,outcome)=>ipcRenderer.send('island:approve',id,outcome),
  chat:(id,sessionId,text,mode)=>ipcRenderer.send('island:chat',id,sessionId,text,mode),
  stats:()=>ipcRenderer.send('island:stats'),
  preview:state=>ipcRenderer.send('island:preview',state)
});
