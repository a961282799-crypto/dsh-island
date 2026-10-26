import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
import {runtimePath} from '../src/runtime.js';
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const child=spawn(runtimePath(),[resolve('desktop/main.cjs'),'--preview','--cycle',`--island-data=${resolve('.preview')}`],{env,windowsHide:true,stdio:'inherit'});
child.on('error',error=>{console.error(error.message);process.exitCode=1;});
child.on('exit',code=>{process.exitCode=code??0;});
