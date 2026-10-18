/* ============================================================
 * 白膜工作台 · 场景播放器
 * 通过 blob iframe 加载场景 HTML（同源），
 * 用 postMessage 协议驱动桥接脚本（规范文件/旧文件统一接口）。
 *   父→子: { __wb:'cmd', id, cmd, ...args }
 *   子→父: { __wb:'resp', id, ok, ...payload } / { __wb:'ready' } / { __wb:'hello' }
 * ============================================================ */

const CMD_TIMEOUT = 12000;

export class SceneController {
  /**
   * @param {HTMLIFrameElement} iframe 已插入 DOM 的 iframe
   * @param {(msg:object)=>void} onLog 场景内错误日志回调
   */
  constructor(iframe, onLog = () => {}) {
    this.iframe = iframe;
    this.onLog = onLog;
    this.record = null;
    this.blobURL = null;
    this.pending = new Map();
    this.idn = 0;
    this.helloInfo = null;
    this._onMessage = (ev) => {
      const d = ev.data || {};
      if (d.__wb === 'resp' && this.pending.has(d.id)) {
        const { resolve, timer } = this.pending.get(d.id);
        clearTimeout(timer);
        this.pending.delete(d.id);
        d.ok ? resolve(d) : resolve({ ok: false, error: d.error || 'unknown' });
      } else if (d.__wb === 'log') {
        this.onLog(d);
      }
    };
    window.addEventListener('message', this._onMessage);
  }

  _cmd(cmd, args = {}, timeout = CMD_TIMEOUT) {
    return new Promise((resolve) => {
      const id = ++this.idn;
      const timer = setTimeout(() => { this.pending.delete(id); resolve({ ok: false, error: 'timeout' }); }, timeout);
      this.pending.set(id, { resolve, timer });
      this.iframe.contentWindow?.postMessage({ __wb: 'cmd', id, cmd, ...args }, '*');
    });
  }

  /** 加载场景：blob URL → 等 hello → 等 ready。返回 hello 信息 */
  load(record) {
    this.dispose();
    this.record = record;
    this.blobURL = URL.createObjectURL(new Blob([record.html], { type: 'text/html' }));
    return new Promise((resolve) => {
      const helloP = new Promise((res) => {
        const t = setTimeout(() => res({ ok: false, error: 'hello-timeout' }), 20000);
        const h = (ev) => {
          const d = ev.data || {};
          if (d.__wb === 'hello') { clearTimeout(t); window.removeEventListener('message', h); res({ ok: true, tier: d.tier }); }
        };
        window.addEventListener('message', h);
      });
      const readyP = new Promise((res) => {
        const t = setTimeout(() => res({ ok: false, error: 'ready-timeout' }), 25000);
        const h = (ev) => {
          const d = ev.data || {};
          if (d.__wb === 'ready') {
            clearTimeout(t); window.removeEventListener('message', h);
            res({ ok: !d.failed, info: d });
          }
        };
        window.addEventListener('message', h);
      });

      this.iframe.onload = async () => {
        const hello = await helloP;
        const ready = await readyP;
        this.helloInfo = ready.ok ? ready.info : null;
        // 兼容层会上报真实时长/跳转点
        if (ready.ok && ready.info && ready.info.tier === 'legacy') {
          if (ready.info.duration && !record.manifest.duration) {
            record.manifest.duration = Math.round(ready.info.duration * 10) / 10;
          }
          if ((!record.manifest.shots || !record.manifest.shots.length) && ready.info.jumps && ready.info.jumps.length) {
            record.manifest.shots = ready.info.jumps.map(j => ({ t: j.t, label: j.label || `${j.t}s` }));
          }
          record._legacyHasDisplay = !!ready.info.hasDisplay;
        }
        resolve({ hello, ready });
      };
      this.iframe.src = this.blobURL;
    });
  }

  async play() { return this._cmd('play'); }
  async pause() { return this._cmd('pause'); }
  async setSpeed(v) { return this._cmd('setSpeed', { v }); }
  async seek(t) { return this._cmd('seek', { t }); }
  async getState() { return this._cmd('state', {}, 6000); }

  /** 截取 t 秒画面，返回 JPEG dataURL（失败返回 null） */
  async grab(t, timeout = 20000) {
    const r = await this._cmd('grab', { t }, timeout);
    return r.ok && r.dataURL ? r.dataURL : null;
  }

  /** 把场景当前帧缩略成 320×180 JPEG dataURL */
  async makeThumb(t = 0.5) {
    const url = await this.grab(t);
    if (!url) return null;
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = 320; c.height = 180;
        const ctx = c.getContext('2d');
        // 居中裁切保持比例
        const ar = img.width / img.height, tar = 320 / 180;
        let sw = img.width, sh = img.height, sx = 0, sy = 0;
        if (ar > tar) { sw = img.height * tar; sx = (img.width - sw) / 2; }
        else { sh = img.width / tar; sy = (img.height - sh) / 2; }
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, 320, 180);
        resolve(c.toDataURL('image/jpeg', 0.72));
      };
      img.onerror = () => resolve(null);
      img.src = url;
    });
  }

  dispose() {
    for (const { timer } of this.pending.values()) clearTimeout(timer);
    this.pending.clear();
    if (this.blobURL) { URL.revokeObjectURL(this.blobURL); this.blobURL = null; }
    this.iframe.onload = null;
    try { this.iframe.src = 'about:blank'; } catch (e) {}
    this.record = null;
    this.helloInfo = null;
  }

  destroy() {
    this.dispose();
    window.removeEventListener('message', this._onMessage);
  }
}
