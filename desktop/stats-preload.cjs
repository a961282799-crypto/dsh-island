const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('usageStats',{
  request:range=>ipcRenderer.send('stats:request',range),
  subscribe:callback=>{const fn=(_event,data)=>callback(data);ipcRenderer.on('stats:data',fn);return()=>ipcRenderer.removeListener('stats:data',fn);}
});
