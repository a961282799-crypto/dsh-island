import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { orbRuntimeReady, resolveRuntime, runtimeCandidates, runtimeHelp, runtimePath } from '../src/runtime.js';
import { promptRuntimeHelp, runtimeHelpText, vbsScript } from '../src/notify.js';

const temp = () => mkdtempSync(join(tmpdir(), 'dsh-island-runtime-'));
const electronAt = (dir, name = 'electron.exe') => { mkdirSync(dir, { recursive: true }); const file = join(dir, name); writeFileSync(file, ''); return file; };

test('the environment variable wins over the dsh-orb runtime', () => {
  const root = temp();
  const orb = electronAt(join(root, 'dsh-orb', 'electron-runtime'));
  const own = electronAt(join(root, 'my-electron'));
  const found = resolveRuntime({ DSH_HOME: root, DSH_ISLAND_ELECTRON: own }, 'win32');
  assert.equal(found.path, own);
  assert.equal(found.source, 'DSH_ISLAND_ELECTRON');
  assert.equal(found.verified, true);
  assert.equal(orb, join(root, 'dsh-orb', 'electron-runtime', 'electron.exe'));
});

test('dsh-orb is the fallback and its completion marker decides "verified"', () => {
  const root = temp();
  const orbDir = join(root, 'dsh-orb', 'electron-runtime');
  electronAt(orbDir);
  assert.equal(orbRuntimeReady(orbDir), false);
  let found = resolveRuntime({ DSH_HOME: root }, 'win32');
  assert.equal(found.source, 'dsh-orb');
  assert.equal(found.verified, false, 'a half-finished download is usable but not trusted');

  writeFileSync(join(orbDir, '.complete-44.0.0'), '');
  assert.equal(orbRuntimeReady(orbDir), true);
  found = resolveRuntime({ DSH_HOME: root }, 'win32');
  assert.equal(found.verified, true);
});

test('a missing runtime reports every path it tried, not just a stack trace', () => {
  const root = temp();
  const missing = join(root, 'dsh-orb', 'electron-runtime', 'electron.exe');
  const found = resolveRuntime({ DSH_HOME: root }, 'win32');
  assert.equal(found.path, undefined);
  assert.deepEqual(found.tried, [missing]);
  assert.match(found.error, /dsh-orb/);
  assert.match(found.error, /DSH_ISLAND_ELECTRON/);
  assert.match(found.error, /已经找过/);
  assert.throws(() => runtimePath({ DSH_HOME: root }, 'win32'), /Electron 运行环境/);
});

test('candidates are ordered: explicit path, then the dsh-orb runtime', () => {
  const list = runtimeCandidates({ DSH_HOME: 'C:/home', DSH_ISLAND_ELECTRON: 'C:/e/electron.exe' }, 'win32');
  assert.deepEqual(list.map(c => c.source), ['DSH_ISLAND_ELECTRON', 'dsh-orb']);
  assert.ok(list[1].path.endsWith(join('dsh-orb', 'electron-runtime', 'electron.exe')));
  assert.equal(runtimeCandidates({}, 'win32')[0].source, 'dsh-orb');
});

test('the help text names both fixes and the paths already checked', () => {
  const text = runtimeHelp(['C:/a/electron.exe']);
  assert.match(text, /dsh-orb/);
  assert.match(text, /DSH_ISLAND_ELECTRON/);
  assert.match(text, /已经找过：C:\/a\/electron\.exe/);
});

test('the Windows prompt script opens the notes only when asked, and never breaks on quotes', () => {
  const file = 'C:\\Users\\a b\\runtime-help.txt';
  const script = vbsScript({ title: '灵动岛', lines: ['原因：找不到 "Electron"'], file });
  assert.match(script, /MsgBox/);
  assert.match(script, /""Electron""/, 'quotes inside the message are doubled for VBScript');
  assert.match(script, /vbYesNo \+ vbExclamation/);
  assert.match(script, /notepad\.exe/);
  assert.ok(script.includes(`If answer = vbYes And Len("${file}") > 0 Then`));
  process.env.DSH_ISLAND_NO_PROMPT = '1';
  assert.equal(promptRuntimeHelp({ dataDir: temp() }), false, 'tests never pop a real dialog');
  delete process.env.DSH_ISLAND_NO_PROMPT;
});

test('the help file explains the cause, the fix and Electron’s last words', () => {
  const text = runtimeHelpText({ reason: '找不到运行环境', tried: ['C:/x'], stderr: ['Error: missing dll'] });
  assert.match(text, /原因：找不到运行环境/);
  assert.match(text, /dsh-orb/);
  assert.match(text, /DSH_ISLAND_ELECTRON/);
  assert.match(text, /已经找过：C:\/x/);
  assert.match(text, /Error: missing dll/);
  assert.ok(existsSync(tmpdir()));
});
