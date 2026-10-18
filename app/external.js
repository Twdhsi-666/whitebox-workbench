// 外来白膜页面的宿主：把任意 AI 生成的 HTML 装进 iframe，用 bridge 里的协议统一驱动。
// 安全说明（写进 docs/决策记录.md）：iframe 不设 sandbox，因为设了之后子页取本地 three 需要额外 CORS，
// GitHub Pages 上不可控。代价是被导入的页面与工作台同源，能读到浏览器的工程存档。
// 只导入你自己生成的文件；别人发你的 HTML 先用本地模式打开，别在共享机器上乱拖。
import { bridgeSource } from '../engine/bridge.js';

const LOCAL_THREE = new URL('vendor/three.module.js', location.href).href;
let seq = 0;

export function prepare(htmlText) {
  const warnings = [];
  let html = htmlText;

  const im = /<script[^>]*type\s*=\s*["']importmap["'][^>]*>([\s\S]*?)<\/script>/i.exec(html);
  if (im) {
    let map = null;
    try { map = JSON.parse(im[1]); } catch (e) { warnings.push('页面里的 importmap 不是合法 JSON，已重建成只指向本地 three'); }
    const imports = (map && map.imports) || {};
    const addonKeys = Object.keys(imports).filter(k => k !== 'three' && /three/.test(k) && /addon|examples|jsm/i.test(imports[k]));
    if (addonKeys.length) warnings.push(`这个页面还用了 three 的扩展模块（${addonKeys.join('、')}），工作台只镜像了 three 本体，可能加载失败`);
    imports.three = LOCAL_THREE;
    html = html.slice(0, im.index) + '<script type="importmap">' + JSON.stringify({ imports }, null, 1) + '</script>' + html.slice(im.index + im[0].length);
  } else if (/from\s+['"]three['"]/.test(html) || /import\s+.*['"]https?:\/\/[^'"]*three/i.test(html)) {
    html = html.replace(/<head([^>]*)>/i, '<head$1>\n<script type="importmap">' + JSON.stringify({ imports: { three: LOCAL_THREE } }) + '</script>');
    warnings.push('页面没有 importmap，已自动补一个指向本地 three');
  }
  const other = [...html.matchAll(/(?:src|href)\s*=\s*["'](https?:\/\/[^"']+)["']/g)].map(m => m[1]).filter(u => !/three/i.test(u));
  if (other.length) warnings.push(`检测到 ${other.length} 个外部资源（字体/图片/脚本），离线时可能加载不出来`);

  const ch = 'wm' + (++seq) + '_' + Math.random().toString(36).slice(2, 7);
  const inject = '<script>' + bridgeSource(ch) + '</script>';
  if (/<head[^>]*>/i.test(html)) html = html.replace(/<head([^>]*)>/i, '<head$1>' + inject);
  else html = inject + html;
  return { html, channel: ch, warnings };
}

export class External {
  constructor(holder) {
    this.holder = holder;
    this.iframe = null;
    this.ch = null;
    this.info = null;
    this.pending = new Map();
    this.idn = 0;
    this._onMsg = ev => {
      const d = ev.data;
      if (!d || !this.ch || d.ch !== this.ch) return;
      if (this.iframe && ev.source && ev.source !== this.iframe.contentWindow) return;   // 只收这个 iframe 的回包
      if (d.__wm === 'resp' && this.pending.has(d.id)) { this.pending.get(d.id)(d); this.pending.delete(d.id); }
      if (d.__wm === 'log' && this.onLog) this.onLog(d);
    };
    addEventListener('message', this._onMsg);
  }

  cmd(name, args = {}, ms = 12000) {
    return new Promise(res => {
      const id = ++this.idn;
      const to = setTimeout(() => { this.pending.delete(id); res({ ok: false, error: name + ' 超时（子页没回话）' }); }, ms);
      this.pending.set(id, m => { clearTimeout(to); res(m); });
      try { this.iframe.contentWindow.postMessage({ __wm: 'cmd', id, ch: this.ch, cmd: name, ...args }, '*'); }
      catch (e) { clearTimeout(to); this.pending.delete(id); res({ ok: false, error: String(e.message || e) }); }
    });
  }

  async load(htmlText) {
    this.destroy();
    const { html, channel, warnings } = prepare(htmlText);
    this.ch = channel;
    const f = document.createElement('iframe');
    f.setAttribute('allow', 'autoplay');
    f.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;border:0;background:#000';
    f.srcdoc = html;
    this.holder.appendChild(this.iframe = f);

    // hello 用轮询而不是等 onload：iframe 被拦时 onload 不触发，会永远卡住
    let info = null;
    const t0 = performance.now();
    while (performance.now() - t0 < 25000) {
      const r = await this.cmd('hello', {}, 2000);
      if (r.ok) { info = r; break; }
      await new Promise(res => setTimeout(res, 500));
    }
    if (!info) return { ok: false, error: '页面 25 秒内没接上桥（可能没渲染出 canvas，或者被浏览器拦了）', warnings };
    this.info = info;
    return { ok: true, info, warnings };
  }

  play() { return this.cmd('play'); }
  pause() { return this.cmd('pause'); }
  seek(t) { return this.cmd('seek', { t }); }
  state() { return this.cmd('state', {}, 6000); }
  speed(v) { return this.cmd('speed', { v }); }
  grab(t) { return this.cmd('grab', { t }, 20000); }

  destroy() {
    if (this.iframe) { this.iframe.remove(); this.iframe = null; }
    this.pending.clear();
    this.info = null;
  }
}
