// 工作台自检：headless Edge + CDP 打开 http://127.0.0.1:8951/，按剧本点一遍，逐张存 PNG，并收集页面报错。
// 跑法：node tools/shot.mjs [--url=http://127.0.0.1:8951/] [--out=tools/shots] [--cdp=9233] [--only=1,2]
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const argv = process.argv.slice(2);
const arg = (k, d) => { const a = argv.find(x => x.startsWith('--' + k + '=')); return a ? a.split('=')[1] : d; };
const URL0 = arg('url', 'http://127.0.0.1:8951/');
const OUT = path.join(ROOT, arg('out', 'tools/shots'));
const CDP = Number(arg('cdp', 9233));
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PROFILE = 'C:/Users/Public/edge_shot_' + CDP;
const W = 1600, H = 900;

fs.mkdirSync(OUT, { recursive: true });
const LOGF = path.join(OUT, 'log.txt');
fs.writeFileSync(LOGF, '');
const log = s => { const l = `[${new Date().toISOString().slice(11, 19)}] ${s}\n`; fs.appendFileSync(LOGF, l); process.stdout.write(l); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

try { const r = await fetch(`http://127.0.0.1:${CDP}/json/version`, { signal: AbortSignal.timeout(1200) }); if (r.ok) throw new Error(`CDP ${CDP} 已被占用，换 --cdp`); }
catch (e) { if (String(e.message).includes('已被占用')) throw e; }

const edge = spawn(EDGE, [
  '--headless=new', `--remote-debugging-port=${CDP}`, `--user-data-dir=${PROFILE}`,
  `--window-size=${W},${H}`, '--hide-scrollbars', '--force-device-scale-factor=1',
  '--mute-audio', '--autoplay-policy=user-gesture-required',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
  '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', URL0
], { stdio: 'ignore' });
log(`edge pid=${edge.pid} url=${URL0}`);

let ws;
const pending = new Map();
let idn = 0;
const cmd = (method, params) => new Promise((res, rej) => {
  const id = ++idn;
  const to = setTimeout(() => { pending.delete(id); rej(new Error(method + ' 超时')); }, 45000);
  pending.set(id, m => { clearTimeout(to); m.error ? rej(new Error(method + ': ' + JSON.stringify(m.error).slice(0, 240))) : res(m.result); });
  ws.send(JSON.stringify({ id, method, params: params || {} }));
});
const errors = [];
const evl = async expr => {
  const r = await cmd('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error('页内异常 ' + JSON.stringify(r.exceptionDetails).slice(0, 400));
  return r.result.value;
};

function cleanup(code) {
  try { ws && ws.close(); } catch (e) { }
  try { spawnSync('taskkill', ['/pid', String(edge.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { }
  process.exit(code);
}

try {
  let page = null;
  for (let i = 0; i < 80 && !page; i++) {
    try { const t = await (await fetch(`http://127.0.0.1:${CDP}/json`, { signal: AbortSignal.timeout(2000) })).json(); page = t.find(x => x.type === 'page' && x.webSocketDebuggerUrl); } catch (e) { }
    if (!page) await sleep(250);
  }
  if (!page) throw new Error('CDP 没有 page 目标');
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws 失败')); });
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.method === 'Runtime.consoleAPICalled' && (m.params.type === 'error' || m.params.type === 'warning'))
      errors.push(m.params.type + ' ' + (m.params.args || []).map(a => a.value ?? a.description ?? '').join(' ').slice(0, 240));
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      errors.push('EXC ' + String((d.exception && (d.exception.description || d.exception.value)) || d.text || '').slice(0, 400));
    }
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  await cmd('Runtime.enable');
  await cmd('Page.enable');
  if (argv.includes('--fresh')) { await evl('localStorage.clear()'); await cmd('Page.navigate', { url: URL0 }); await sleep(2500); }

  let ready = false;
  for (let i = 0; i < 40 && !ready; i++) { ready = !!(await evl('!!(window.__wmReady || (document.querySelector("#canvasHolder canvas") && document.querySelector(".shot-block")))')); if (!ready) await sleep(400); }
  await sleep(1200);
  log('页面就绪=' + ready + ' canvas=' + await evl('!!document.querySelector("#canvasHolder canvas")'));

  const shot = async n => {
    const r = await cmd('Page.captureScreenshot', { format: 'png' });
    const f = path.join(OUT, n + '.png');
    fs.writeFileSync(f, Buffer.from(r.data, 'base64'));
    log('shot ' + n + ' ' + Math.round(fs.statSync(f).size / 1024) + 'KB');
  };

  // 剧本：01 首屏 → 02 换场景 → 03 加人+画线 → 04 加机位 → 05 相机视角 → 06 体检 → 07 提示词包 → 08 竖屏
  await shot('01_首屏');
  await evl(`(()=>{const b=[...document.querySelectorAll('#presetList button')];const t=b.find(x=>x.textContent.includes('教室'));if(t)t.click();return b.length})()`);
  await sleep(2500); await shot('02_教室场景');
  await evl(`document.getElementById('btnAddFigure').click()`);
  await sleep(500);
  await evl(`document.getElementById('btnDrawPath').click()`);   // 打开"画路线"模式，否则点地面只是选中
  await sleep(300);
  await evl(`(()=>{const p=document.querySelector('#canvasHolder canvas').getBoundingClientRect();
    for(const [dx,dy] of [[-0.2,-0.05],[-0.05,0.02],[0.1,0.06],[0.25,0.02]]){
      const x=p.left+p.width*(0.5+dx), y=p.top+p.height*(0.5+dy);
      const mk=t=>new PointerEvent(t,{bubbles:true,clientX:x,clientY:y,button:0,pointerId:1});
      document.querySelector('#canvasHolder canvas').dispatchEvent(mk('pointerdown'));
      document.querySelector('#canvasHolder canvas').dispatchEvent(mk('pointerup'));
    } return 1})()`);
  await sleep(400); await shot('03_人物与走位');
  await evl(`document.getElementById('btnAddShot').click()`); await sleep(500);
  await evl(`document.getElementById('btnAddShot').click()`); await sleep(500);
  await evl(`(()=>{const s=document.getElementById('shotMove');s.value='orbit_l';s.dispatchEvent(new Event('change'));return s.value})()`);
  await sleep(700); await shot('04_两个机位与视锥');
  await evl(`document.getElementById('btnViewCam').click()`); await sleep(600); await shot('05_相机视角遮幅');
  await evl(`document.getElementById('btnPack').click()`); await sleep(500); await shot('06_提示词包');
  await evl(`(()=>{const s=document.getElementById('selAspect');s.value='9:16';s.dispatchEvent(new Event('change'));return s.value})()`);
  await sleep(700); await shot('07_竖屏9比16');
  // 09 道具库：切到家具分类 → 点沙发 → 幽灵跟着鼠标 → 地面点一下放下
  const tabs = await evl(`(()=>{const t=[...document.querySelectorAll('#assetTabs button')];const x=t.find(b=>b.textContent.includes('家具'));if(x)x.click();return t.length})()`);
  await sleep(2500);
  const grid = await evl(`(()=>{const b=[...document.querySelectorAll('#assetGrid .asset')];const s=b.find(x=>x.textContent.includes('沙发'));if(s)s.click();return {n:b.length, thumb:b.filter(x=>{const i=x.querySelector('img');return i&&i.src.startsWith('data:')}).length}})()`);
  log(`道具分类 ${tabs} 组｜当前格 ${grid.n} 个｜有缩略图 ${grid.thumb} 个`);
  await sleep(400);
  await evl(`(()=>{const c=document.querySelector('#canvasHolder canvas'),r=c.getBoundingClientRect();
    const x=r.left+r.width*0.42,y=r.top+r.height*0.72;
    const mk=t=>new PointerEvent(t,{bubbles:true,clientX:x,clientY:y,button:0,pointerId:1});
    c.dispatchEvent(mk('pointermove')); c.dispatchEvent(mk('pointerdown')); c.dispatchEvent(mk('pointerup')); return 1})()`);
  await sleep(900);
  await shot('09_道具库摆放');
  const placed = await evl(`({placed:document.querySelectorAll('#placedList .item').length, custom:(window.__probe&&1)||0, hint:document.getElementById('assetHint').textContent})`);
  log('  ' + JSON.stringify(placed));

  await evl(`document.getElementById('btnTheme').click()`); await sleep(700); await shot('08_浅色主题');

  if (argv.includes('--render')) {
    log('开始一键出片（页内逐帧 → 本机 ffmpeg）');
    await evl(`document.getElementById('btnRender').click()`);
    for (let i = 0; i < 240; i++) {
      const busy = await evl(`!document.getElementById('jobMask').classList.contains('hidden')`);
      const msg = await evl(`document.getElementById('jobLog').textContent`);
      if (i % 4 === 0) log('  ' + msg);
      if (!busy) break;
      await sleep(1500);
    }
    await sleep(1200);
    log('  最终：' + await evl(`document.getElementById('jobLog').textContent`));
    await shot('09_出片结果');
  }

  const facts = await evl(`(()=>{
    const g=id=>{const e=document.getElementById(id);return e?(e.textContent||'').trim().slice(0,90):'MISSING'};
    return {shots:document.querySelectorAll('.shot-block').length, presets:document.querySelectorAll('#presetList button').length,
      figures:document.querySelectorAll('#figureList .item').length, outline:document.querySelectorAll('#outline .item').length,
      findings:document.querySelectorAll('#checkList .finding').length, summary:g('checkSummary'), cam:g('hudCam'), mode:g('modeBadge'),
      objects:g('statObjects'), errTip: g('emptyTip'),
      figColor:(()=>{const v=window.__vp;const one=v&&v._figs&&[...v._figs.values()][0];return one?'#'+one.parts.torso.material.color.getHexString():'no-fig'})(),
      ghost:(()=>{const v=window.__vp;return v&&v._ghost?'有':'无'})()};
  })()`);
  log('事实清单 ' + JSON.stringify(facts));
  fs.writeFileSync(path.join(OUT, 'facts.json'), JSON.stringify(facts, null, 2), 'utf8');
  fs.writeFileSync(path.join(OUT, 'errors.txt'), errors.join('\n'), 'utf8');
  log('页面报错 ' + errors.length + ' 条');
  for (const e of errors.slice(0, 12)) log('  ' + e.slice(0, 200));
  cleanup(0);
} catch (e) {
  log('FAIL ' + e.message);
  fs.writeFileSync(path.join(OUT, 'errors.txt'), errors.join('\n') + '\nFATAL ' + e.message, 'utf8');
  cleanup(1);
}
