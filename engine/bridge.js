// 注入进"外来白膜页面"的桥接脚本。两套：
//   Tier A（守规范）：页面自己实现 10 个接口，桥只做转发。跳转精度取决于页面自己，可以逐帧出片。
//   Tier B（旧页面）：接管虚拟时钟硬驱动。只能预览，**不允许逐帧出片**（精度撑死 ±0.2 秒）。
// 相对另一版做的四处修正：① 每条通道带自己的 id，回包校验来源，多实例不再互相吞；
// ② tier 靠运行时探测而不是正则扫源码；③ seek 回包给**实际时间**而不是请求值；④ 截图在渲染回调之后立刻排空队列。
export const BRIDGE_VERSION = 1;

export function bridgeSource(channel) {
  return `(function(){
  if (window.__WM_BRIDGE__) return;
  window.__WM_BRIDGE__ = ${BRIDGE_VERSION};
  var CH = ${JSON.stringify(channel)};
  function send(m){ m.ch = CH; try { parent.postMessage(m, '*'); } catch(e){} }

  // ---- 能力探测（运行时，不看源码）----
  var CORE = ['__seek','__grab','__play','__pause','__getTime'];
  var ALL = ['__ready','__seek','__grab','__size','__glOk','__play','__pause','__playing','__duration','__getTime'];
  function probe(){
    var have = [], missing = [];
    for (var i=0;i<ALL.length;i++){ var k=ALL[i]; (typeof window[k] !== 'undefined' ? have : missing).push(k); }
    var coreOk = CORE.every(function(k){ return typeof window[k] === 'function'; });
    return { have: have, missing: missing, coreOk: coreOk };
  }

  // ---- Tier B：虚拟时钟 ----
  var realPerf = performance.now.bind(performance);
  // 必须在重写之前把原生 rAF/cAF 存下来：重写后再调同名函数就是调自己，直接爆栈（这个坑踩过）
  var realRaf = window.requestAnimationFrame.bind(window);
  var realCaf = window.cancelAnimationFrame.bind(window);
  var vNow = realPerf(), vAnchor = vNow, rAnchor = vNow, speed = 1, playing = false, duration = 0;
  var rafCbs = new Map(), idn = 1, idMap = new Map(), grabQueue = [];
  performance.now = function(){ return vNow; };
  Date.now = function(){ return vNow; };
  window.requestAnimationFrame = function(cb){
    var id = ++idn;
    rafCbs.set(id, cb);
    var real = realRaf(function(ts){
      if (!rafCbs.has(id)) return;
      rafCbs.delete(id);
      idMap.delete(id);
      try { cb(vNow); } catch(e){ send({__wm:'log', type:'error', detail:String(e && e.message || e).slice(0,300)}); }
      // 渲染刚做完，这时取画布最稳（不需要 preserveDrawingBuffer）
      if (grabQueue.length) { var q = grabQueue; grabQueue = []; q.forEach(function(g){ g(); }); }
    });
    idMap.set(id, real);
    return id;
  };
  window.cancelAnimationFrame = function(id){ var r = idMap.get(id); if (r != null) { realCaf(r); idMap.delete(id); rafCbs.delete(id); } };
  (function drive(){
    if (playing) { vNow = vAnchor + (realPerf() - rAnchor) * speed; if (duration && (vNow - vAnchor)/1000 >= duration) { playing = false; } }
    setTimeout(drive, 16);
  })();
  function jump(t){ vNow = t * 1000; vAnchor = vNow; rAnchor = realPerf(); }
  function readDurationFromUI(){
    var el = document.querySelector('#timeDisplay, .info .value, .time, [class*=time]');
    if (!el) return 0;
    var m = /\\/\\s*(\\d+):(\\d+(?:\\.\\d+)?)/.exec(el.textContent || '');
    if (m) return Number(m[1]) * 60 + Number(m[2]);
    m = /(\\d+(?:\\.\\d+)?)\\s*s/.exec(el.textContent || '');
    return m ? Number(m[1]) : 0;
  }
  function findCanvas(){
    var list = [].slice.call(document.querySelectorAll('canvas'));
    return list.sort(function(a,b){ return (b.clientWidth*b.clientHeight) - (a.clientWidth*a.clientHeight); })[0] || null;
  }
  function grabLater(fn){ if (rafCbs.size || playing) grabQueue.push(fn); else { grabQueue.push(fn); setTimeout(function(){ if (rafCbs.size) return; }, 0); } }
  function doGrab(t, reply){
    if (typeof window.__grab === 'function') {
      try { reply({ ok:true, dataURL: window.__grab(t) }); } catch(e){ reply({ ok:false, error:String(e && e.message || e) }); }
      return;
    }
    if (t != null) doSeek(t);
    var done = false;
    var run = function(){
      if (done) return; done = true;
      var c = findCanvas();
      if (!c) return reply({ ok:false, error:'页面里没有 canvas' });
      try { reply({ ok:true, dataURL: c.toDataURL('image/jpeg', 0.9) }); }
      catch (e) { reply({ ok:false, error:'取不到画布：' + String(e && e.message || e) }); }
    };
    grabQueue.push(run);
    // 页面自己停掉了渲染循环时，宁可明确报错，也不要静悄悄回一张黑图
    setTimeout(function(){ if (!done) { done = true; reply({ ok:false, error:'页面当前不在渲染循环里，截不到新帧。按播放后再截，或让它实现 __grab（规范桥）' }); } }, 2500);
  }

  // ---- 命令分发 ----
  function tier(){ return probe().coreOk ? 'A' : 'B'; }
  function getTime(){
    if (typeof window.__getTime === 'function') { try { return Number(window.__getTime()) || 0; } catch(e){} }
    return vNow / 1000;
  }
  function doSeek(t){
    if (tier() === 'A') { try { window.__seek(t); } catch(e){ return { ok:false, error:String(e.message||e) }; } }
    else jump(t);
    return { ok: true, t: getTime() };                 // 回实际时间，不回请求值
  }


  window.addEventListener('message', function(ev){
    var d = ev.data;
    if (!d || d.__wm !== 'cmd' || d.ch !== CH) return;                 // 只认自己这条通道
    var reply = function(o){ o.id = d.id; o.__wm = 'resp'; send(o); };
    try {
      switch (d.cmd) {
        case 'hello': {
          var p = probe();
          duration = (typeof window.__duration === 'number') ? window.__duration : (readDurationFromUI() || 15);
          reply({ ok:true, tier: p.coreOk ? 'A' : 'B', duration: duration, missing: p.missing,
                  exportable: p.coreOk, size: (typeof window.__size==='function'? window.__size() : ''), glOk: !!(typeof window.__glOk==='boolean'? window.__glOk : true) });
          break;
        }
        case 'play': if (tier()==='A' && window.__play) { try { window.__play(); } catch(e){} } playing = true; vAnchor = vNow; rAnchor = realPerf(); reply({ ok:true, playing:true }); break;
        case 'pause': if (tier()==='A' && window.__pause) { try { window.__pause(); } catch(e){} } playing = false; reply({ ok:true, playing:false }); break;
        case 'seek': { var r = doSeek(Number(d.t)||0); reply({ ok:r.ok, t:r.t, error:r.error }); break; }
        case 'state': reply({ ok:true, t:getTime(), playing: tier()==='A' ? !!window.__playing : playing, duration: duration, tier: tier() }); break;
        case 'speed': speed = Math.max(0.1, Math.min(4, Number(d.v)||1)); reply({ ok:true, speed:speed }); break;
        case 'grab': doGrab(d.t == null ? null : Number(d.t), reply); break;
        default: reply({ ok:false, error:'未知命令 ' + d.cmd });
      }
    } catch (e) { reply({ ok:false, error:String(e && e.message || e).slice(0,200) }); }
  });

  // 旧页面一加载就自己往前跑，先把时间按回 0.2 秒并暂停，否则构建耗时会烧进时间轴
  function arm(){ jump(0.2); playing = false; if (tier()==='A' && window.__pause) { try { window.__pause(); } catch(e){} } }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function(){ setTimeout(arm, 120); });
  else setTimeout(arm, 120);
  send({ __wm:'hello', version: ${BRIDGE_VERSION} });
})();`;
}
