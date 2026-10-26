import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
const result=spawnSync(process.env.DSH_HOST_EXECUTABLE||'D:/deepseek harness/DeepSeek Harness.exe',[resolve('tests/host-contract.cjs')],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},windowsHide:true,stdio:'inherit',timeout:60000});
if(result.error)throw result.error;process.exitCode=result.status??1;
