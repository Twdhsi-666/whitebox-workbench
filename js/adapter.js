/* ============================================================
 * 白膜工作台 · 场景桥接脚本
 * 两种桥接，由 importer.js 在导入时注入到场景 HTML 的 <head> 后：
 *
 *  BRIDGE_SPEC   —— 规范文件（Tier A）用：设置 __EMBED__，
 *                   把 window.__seek/__play/... 转发成 postMessage 接口。
 *  BRIDGE_LEGACY —— 旧文件（Tier B）用：虚拟时钟适配器。
 *                   打补丁 performance.now/Date.now/requestAnimationFrame，
 *                   从而完全接管旧文件的播放/暂停/跳转/截图；
 *                   自动隐藏旧面板、让画布铺满。
 *
 * 两个桥都通过 postMessage 与工作台通信（协议见 player.js）：
 *   父→子: { __wb:'cmd', id, cmd, ...args }
 *   子→父: { __wb:'resp', id, ok, ...payload } / { __wb:'ready', ... } / { __wb:'hello' }
 * ============================================================ */

export const WB_BRIDGES = {

/* ------------------------------------------------------------
 * Tier A：规范文件转发桥
 * ------------------------------------------------------------ */
spec: `
(function(){
  if (window.__WB_BRIDGE__) return;
  window.__WB_BRIDGE__ = 'spec';
  window.__EMBED__ = true;
  function send(msg){ try { parent.postMessage(msg, '*'); } catch(e){} }
  window.addEventListener('message', function(ev){
    var d = ev.data || {};
    if (!d.__wb || d.__wb !== 'cmd') return;
    var id = d.id, cmd = d.cmd;
    var reply = function(ok, payload){ send(Object.assign({ __wb:'resp', id:id, ok:ok }, payload||{})); };
    try {
      if (cmd === 'hello') {
        reply(true, { tier:'spec', duration: window.__duration || null, playing: !!window.__playing,
          size: window.__size ? window.__size() : null, glOk: !!window.__glOk });
      } else if (cmd === 'play')  { if (window.__play) window.__play();  reply(true, { playing: !!window.__playing }); }
      else if (cmd === 'pause')   { if (window.__pause) window.__pause(); reply(true, { playing: !!window.__playing }); }
      else if (cmd === 'seek')    { if (window.__seek) window.__seek(d.t); reply(true, { t: d.t }); }
      else if (cmd === 'grab')    { var u = window.__grab ? window.__grab(d.t) : null; reply(true, { dataURL: u }); }
      else if (cmd === 'state')   { reply(true, { t: window.__getTime ? window.__getTime() : null, playing: !!window.__playing, duration: window.__duration || null }); }
      else reply(false, { error: 'unknown cmd: ' + cmd });
    } catch (e) { reply(false, { error: String((e && e.message) || e) }); }
  });
  var n = 0;
  (function readyLoop(){
    if (window.__ready === true) { if (++n >= 3) { send({ __wb:'ready', tier:'spec' }); return; } }
    else n = 0;
    requestAnimationFrame(readyLoop);
  })();
  send({ __wb:'hello', tier:'spec' });
})();
`,

/* ------------------------------------------------------------
 * Tier B：旧文件虚拟时钟适配器
 * ------------------------------------------------------------ */
legacy: `
(function(){
  if (window.__WB_BRIDGE__) return;
  window.__WB_BRIDGE__ = 'legacy';
  window.__EMBED__ = true;
  function send(msg){ try { parent.postMessage(msg, '*'); } catch(e){} }
  function report(type, detail){ send({ __wb:'log', type:type, detail:String(detail||'').slice(0,300) }); }

  /* ---------- 虚拟时钟 ---------- */
  var realPerfNow = performance.now.bind(performance);
  var vNow = realPerfNow(), vAnchor = vNow, rAnchor = vNow, speed = 1, playing = false;

  performance.now = function(){ return vNow; };
  Date.now = function(){ return vNow; };

  /* rAF 包装：回调收到虚拟时间戳；渲染后执行截图队列 */
  var realRaf = window.requestAnimationFrame.bind(window);
  var realCaf = window.cancelAnimationFrame.bind(window);
  var idMap = new Map(), idn = 0, grabQueue = [];
  window.requestAnimationFrame = function(cb){
    var id = ++idn;
    var wrapped = function(ts){
      try { cb(vNow); }
      catch(e){ report('scene-frame-error', (e && e.message) || e); }
      while (grabQueue.length) { var g = grabQueue.shift(); try { g(captureCanvas()); } catch(e){ g(null); } }
    };
    idMap.set(id, realRaf(wrapped));
    return id;
  };
  window.cancelAnimationFrame = function(id){
    var r = idMap.get(id);
    if (r !== undefined) { realCaf(r); idMap.delete(id); }
  };

  /* 驱动器：播放时按真实时间推进虚拟时钟 */
  (function drive(){
    if (playing) { var r = realPerfNow(); vNow = vAnchor + (r - rAnchor) * speed; }
    realRaf(drive);
  })();

  function captureCanvas(){
    var c = document.querySelector('#stage canvas') || document.querySelector('canvas');
    if (!c) return null;
    try { return c.toDataURL('image/jpeg', 0.92); } catch(e){ return null; }
  }
  function afterFrames(n, cb){ var i = 0; (function f(){ if (i++ >= n) return cb(); realRaf(f); })(); }

  /* ---------- 界面手术：隐藏旧面板，画布铺满 ---------- */
  function surgery(){
    var p = document.getElementById('panel') || document.querySelector('aside') ||
            document.querySelector('#controls') || document.querySelector('.panel');
    if (p && p !== document.body) p.style.setProperty('display', 'none', 'important');
    var st = document.getElementById('stage'); if (!st) return;
    var wrap = document.getElementById('stageWrap') || st.parentElement;
    if (wrap && wrap !== document.body) {
      wrap.style.setProperty('display','block','important');
      wrap.style.setProperty('padding','0','important');
      wrap.style.width = '100%'; wrap.style.height = '100%'; wrap.style.background = '#000';
    }
    st.style.setProperty('aspect-ratio','auto','important');
    st.style.setProperty('max-width','none','important');
    st.style.setProperty('max-height','none','important');
    st.style.width = '100%'; st.style.height = '100%'; st.style.boxShadow = 'none';
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    Array.prototype.forEach.call(document.querySelectorAll('.tip'), function(el){
      el.style.setProperty('display','none','important');
    });
  }

  /* ---------- 场景内省（读旧面板上的时间显示） ---------- */
  function displayEl(){ return document.getElementById('timeDisplay') || document.querySelector('.info .value'); }
  function readT(){
    var el = displayEl(); if (!el) return null;
    var m = /(\\d+):(\\d+(?:\\.\\d+)?)/.exec(el.textContent || '');
    return m ? parseInt(m[1],10)*60 + parseFloat(m[2]) : null;
  }
  function readDur(){
    var el = displayEl(); if (!el) return null;
    var m = /\\/\\s*(\\d+):(\\d+(?:\\.\\d+)?)/.exec(el.textContent || '');
    return m ? parseInt(m[1],10)*60 + parseFloat(m[2]) : null;
  }
  function readJumps(){
    var out = [];
    Array.prototype.forEach.call(document.querySelectorAll('[data-jump]'), function(b){
      var t = parseFloat(b.getAttribute('data-jump'));
      if (!isNaN(t)) out.push({ t: t, label: (b.textContent || '').trim() });
    });
    out.sort(function(a,b){ return a.t - b.t; });
    return out;
  }
  function theirBtn(){ return document.getElementById('playBtn'); }
  function theirPlaying(){
    var b = theirBtn(); if (!b) return null;
    return !/播放|▶/.test(b.textContent || '');   // 显示"⏸ 暂停"即播放中
  }
  /* 让旧场景回到"按时钟走"的状态（它们暂停/播完后会切到 frozenTime 模式）。
     返回恢复时的时间点；点击后同步校准 startTimeRef。 */
  function rearm(){
    var b = theirBtn();
    if (b && theirPlaying() === false) {
      var ft = readT();                 // 暂停态下显示静止，读数精确
      b.click();                        // 它们的 play(): startTime = perf.now() - frozenTime*1000
      if (ft !== null) startTimeRef = vNow - ft * 1000;
      return ft;
    }
    return readT();
  }

  var startTimeRef = null;    // 虚拟毫秒原点：旧场景 t=0 对应的 vNow
  function calibrate(){
    var t = readT();
    if (t === null) { startTimeRef = null; return null; }
    startTimeRef = vNow - t * 1000;
    return t;
  }
  function virtT(){ return startTimeRef === null ? null : (vNow - startTimeRef) / 1000; }

  /* ---------- 命令 ---------- */
  window.addEventListener('message', function(ev){
    var d = ev.data || {};
    if (!d.__wb || d.__wb !== 'cmd') return;
    var id = d.id, cmd = d.cmd;
    var reply = function(ok, payload){ send(Object.assign({ __wb:'resp', id:id, ok:ok }, payload||{})); };
    try {
      if (cmd === 'hello') {
        reply(true, {
          tier: 'legacy', duration: readDur(), hasDisplay: !!displayEl(), jumps: readJumps(),
          glOk: (function(){ try { var c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch(e){ return false; } })(),
          size: (function(){ var c = document.querySelector('#stage canvas') || document.querySelector('canvas'); return c ? c.width + 'x' + c.height : null; })()
        });
      }
      else if (cmd === 'play') {
        rearm();
        playing = true; vAnchor = vNow; rAnchor = realPerfNow();
        reply(true, { playing: true });
      }
      else if (cmd === 'pause') {
        playing = false;
        reply(true, { playing: false });
      }
      else if (cmd === 'setSpeed') {
        speed = Math.max(0.1, Math.min(4, parseFloat(d.v) || 1));
        vAnchor = vNow; rAnchor = realPerfNow();
        reply(true, { speed: speed });
      }
      else if (cmd === 'seek') {
        rearm();
        var tCur = calibrate();
        if (startTimeRef === null) { reply(false, { error: 'scene-time-unreadable' }); return; }
        var target = Math.max(0, d.t);
        vNow = startTimeRef + target * 1000; vAnchor = vNow; rAnchor = realPerfNow();
        afterFrames(3, function(){
          var tAct = readT();
          if (tAct !== null && Math.abs(tAct - target) > 0.2) {
            vNow += (target - tAct) * 1000; vAnchor = vNow; rAnchor = realPerfNow();
            afterFrames(2, function(){ reply(true, { t: readT() }); });
          } else reply(true, { t: tAct === null ? target : tAct });
        });
      }
      else if (cmd === 'grab') {
        var doGrab = function(){
          grabQueue.push(function(url){ reply(true, { dataURL: url }); });
          setTimeout(function(){
            if (grabQueue.length) { var g = grabQueue.shift(); try { g(captureCanvas()); } catch(e){ g(null); } }
          }, 600);
        };
        if (typeof d.t === 'number') {
          rearm(); var tc = calibrate();
          if (startTimeRef === null) { doGrab(); return; }
          vNow = startTimeRef + Math.max(0, d.t) * 1000; vAnchor = vNow; rAnchor = realPerfNow();
          afterFrames(3, doGrab);
        } else doGrab();
      }
      else if (cmd === 'state') {
        var t = readT(), dur = readDur(), tp = theirPlaying();
        var ended = (dur !== null && t !== null && t >= dur - 0.06);
        if (ended) playing = false;
        var vt = virtT();
        if (vt !== null && dur !== null) vt = Math.min(vt, dur);
        reply(true, {
          t: vt !== null ? vt : t, displayT: t,
          playing: ended ? false : (tp === null ? playing : (playing && tp !== false)),
          ended: ended, duration: dur, theirPlaying: tp
        });
      }
      else reply(false, { error: 'unknown cmd: ' + cmd });
    } catch (e) { reply(false, { error: String((e && e.message) || e) }); }
  });

  /* ---------- 就绪检测：等画布出现 ---------- */
  var tries = 0;
  (function waitCanvas(){
    var c = document.querySelector('#stage canvas') || document.querySelector('canvas');
    if (c) {
      surgery();
      /* 复位到 0.2s 并暂停：旧文件模块初始化即起播，且构建耗时会计入时间轴，
         不复位的话打开场景时已跳到几秒后（甚至已播完）。 */
      rearm();
      var t0 = calibrate();
      if (startTimeRef !== null) {
        vNow = startTimeRef + 200;
        vAnchor = vNow; rAnchor = realPerfNow();
      }
      playing = false;
      send({ __wb:'ready', tier:'legacy', duration: readDur(), hasDisplay: !!displayEl(),
             jumps: readJumps(), t0: t0 });
      return;
    }
    if (++tries > 300) { send({ __wb:'ready', tier:'legacy', failed: true, error: 'canvas-timeout' }); return; }
    setTimeout(waitCanvas, 50);
  })();
  send({ __wb:'hello', tier:'legacy' });
})();
`
};
