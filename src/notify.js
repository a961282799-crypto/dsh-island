import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const vbs = text => `"${String(text).replace(/"/g, '""')}"`;

/** 生成一个只做一件事的 VBScript：弹出说明框，点“是”就用记事本打开详细说明。 */
export function vbsScript({ title, lines = [], file = '' } = {}) {
  return [
    'On Error Resume Next',
    'Dim answer',
    `answer = MsgBox(Join(Array(${lines.map(vbs).join(', ')}), vbCrLf), vbYesNo + vbExclamation, ${vbs(title)})`,
    'If answer = vbYes And Len(' + vbs(file) + ') > 0 Then',
    `  CreateObject("WScript.Shell").Run "notepad.exe " & Chr(34) & ${vbs(file)} & Chr(34), 1, False`,
    'End If',
    '',
  ].join('\r\n');
}

/**
 * Windows 上的原生提示框。宿主是 Node 进程，没有 Harness 界面可用，
 * 所以“灵动岛没出现”这类失败必须以用户看得见的方式出现，不能只写日志。
 * @returns {boolean} 是否已弹出（非 Windows 或测试环境下为 false）
 */
export function promptRuntimeHelp({ dataDir, file, title = 'DeepSeek Island · 灵动岛没有显示', lines = [] } = {}) {
  if (process.platform !== 'win32' || process.env.DSH_ISLAND_NO_PROMPT) return false;
  try {
    mkdirSync(dataDir, { recursive: true });
    const script = join(dataDir, 'runtime-warning.vbs');
    writeFileSync(script, '\uFEFF' + vbsScript({ title, lines, file }), 'utf16le');
    const child = spawn('wscript.exe', [script], { detached: true, stdio: 'ignore', windowsHide: true });
    child.on('error', () => {});
    child.unref();
    return true;
  } catch { return false; }
}

/** 状态文件里给人看的一段话：原因 + 两条修复路径 + 已查找的位置。 */
export function runtimeHelpText({ reason, tried = [], stderr = [] } = {}) {
  const lines = [
    'DeepSeek Island · 灵动岛没有显示',
    '',
    `原因：${reason || '未知'}`,
    '',
    '解决办法（任选其一，然后重新打开 Harness）：',
    '  1. 安装悬浮球插件 dsh-orb：它会自动下载 Electron，灵动岛会复用它；',
    '  2. 下载任意 Electron，把用户环境变量 DSH_ISLAND_ELECTRON 设为 electron.exe 的完整路径。',
    '',
    '改完后也可以先在 Harness 的 设置 › 灵动岛 里改动任意一个选项，插件会立刻重新尝试启动。',
  ];
  if (tried.length) lines.push('', `已经找过：${tried.join('、')}`);
  if (stderr.length) lines.push('', 'Electron 最后的输出：', ...stderr.map(line => `  ${line}`));
  return lines.join('\r\n');
}
