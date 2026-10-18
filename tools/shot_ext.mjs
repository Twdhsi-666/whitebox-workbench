// 外来白膜导入的端到端自检：打开工作台 → 从 models/ 库里选一个真实页面 → 看桥接等级 → 跳转 → 截图存盘。
// 跑法：node tools/shot_ext.mjs [--url=http://127.0.0.1:8951/] [--t=6.5]
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const argv = process.argv.slice(2);
const arg = (k, d) => { const a = argv.find(x => x.startsWith('--' + k + '=')); return a ? a.split('=')[1] : d; };
const URL0 = arg('url', 'http://127.0.0.1:8951/');
const TSEEK = Number(arg('t', 6.5));
const OUT = path.join(ROOT, 'tools', 'shots');
const CDP = Number(arg('cdp', 9234));
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

fs.mkdirSync(OUT, { recursive: true });
const log = s => { console.log(s); fs.appendFileSync(path.join(OUT, 'ext.log'), s + '\n'); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const edge = spawn(EDGE, ['--headless=new', `--remote-debugging-port=${CDP}`, `--user-data-dir=C:/Users/Public/edge_ext_${CDP}`,
  '--window-size=1600,900', '--hide-scrollbars', '--mute-audio', '--autoplay-policy=user-gesture-required',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', URL0], { stdio: 'ignore' });

let ws, idn = 0;
const pending = new Map();
const cmd = (m, p) => new Promise((res, rej) => {
  const id = ++idn, to = setTimeout(() => { pending.delete(id); rej(new Error(m + ' 超时')); }, 60000);
  pending.set(id, r => { clearTimeout(to); r.error ? rej(new Error(JSON.stringify(r.error).slice(0, 200))) : res(r.result); });
  ws.send(JSON.stringify({ id, method: m, params: p || {} }));
});
const evl = async expr => {
  const r = await cmd('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error('页内异常 ' + JSON.stringify(r.exceptionDetails).slice(0, 300));
  return r.result.value;
};
const errs = [];
function bye(code) { try { ws && ws.close(); } catch (e) { } try { spawnSync('taskkill', ['/pid', String(edge.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { } process.exit(code); }

try {
  let page = null;
  for (let i = 0; i < 80 && !page; i++) {
    try { const t = await (await fetch(`http://127.0.0.1:${CDP}/json`, { signal: AbortSignal.timeout(2000) })).json(); page = t.find(x => x.type === 'page' && x.webSocketDebuggerUrl); } catch (e) { }
    if (!page) await sleep(250);
  }
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws 失败')); });
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.method === 'Runtime.exceptionThrown') errs.push(String(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).split('\n')[0].slice(0, 180));
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  await cmd('Runtime.enable');
  for (let i = 0; i < 40; i++) { if (await evl('!!window.__wmReady')) break; await sleep(400); }
  await sleep(1500);

  const pick = await evl(`(()=>{const s=document.getElementById('extLib'); if(!s) return '库里没有可选页面（本地服务没起来？models/ 是空的？）'; s.value=s.options[1].value; s.dispatchEvent(new Event('change')); return s.options[1].value})()`);
  log('导入：' + pick);
  await sleep(10000);
  log('状态条：' + JSON.stringify(await evl(`({tier:document.getElementById('extTier').textContent, time:document.getElementById('extTime').textContent, warn:document.getElementById('extWarn').textContent.slice(0,160)})`)));

  const r = await evl(`(async()=>{ const e=window.__ext; if(!e||!e.info) return {err:'桥没接上'};
    const p = await e.play(); await new Promise(k=>setTimeout(k,1200)); const s1 = await e.state();
    const sk = await e.seek(${TSEEK}); await new Promise(k=>setTimeout(k,900)); const s2 = await e.state();
    const g = await e.grab(${TSEEK});
    return { tier:e.info.tier, duration:e.info.duration, exportable:e.info.exportable, missing:e.info.missing,
      播放中时间:s1.t, 跳转请求:${TSEEK}, 跳转回包:sk.t, 跳转后状态:s2.t, 截图字节:g.dataURL?g.dataURL.length:0, 截图错:g.error||'' }; })()`);
  log('驱动结果：' + JSON.stringify(r, null, 1));

  if (r.截图字节 > 20000) {
    const b64 = await evl(`(async()=>(await window.__ext.grab(${TSEEK})).dataURL.split(',')[1])()`);
    const f = path.join(OUT, 'external_frame.jpg');
    fs.writeFileSync(f, Buffer.from(b64, 'base64'));
    log('已存截图 ' + f + '（' + Math.round(fs.statSync(f).size / 1024) + 'KB）');
    const png = await cmd('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, '10_外来白膜.png'), Buffer.from(png.data, 'base64'));
    log('已存整页 10_外来白膜.png');
  }
  log('页面报错 ' + errs.length + ' 条' + (errs.length ? '：' + errs.slice(0, 4).join(' || ') : ''));
  bye(0);
} catch (e) {
  log('FAIL ' + e.message);
  bye(1);
}
