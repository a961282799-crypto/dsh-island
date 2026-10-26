const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('island',{
  initial:()=>ipcRenderer.invoke('island:initial'),
  subscribe:callback=>{const fn=(_event,data)=>callback(data);ipcRenderer.on('island:snapshot',fn);return()=>ipcRenderer.removeListener('island:snapshot',fn);},
  settings:value=>ipcRenderer.send('island:settings',value),
  bounds:value=>ipcRenderer.send('island:bounds',value),
  menu:()=>ipcRenderer.send('island:menu'),
  open:()=>ipcRenderer.send('island:open'),
  hide:()=>ipcRenderer.send('island:hide'),
  stop:sessionId=>ipcRenderer.send('island:stop',sessionId),
  panel:()=>ipcRenderer.send('island:panel'),
  answer:(callId,answers)=>ipcRenderer.send('island:answer',callId,answers),
  preview:state=>ipcRenderer.send('island:preview',state)
});
