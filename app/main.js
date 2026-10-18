import { Viewport } from './viewport.js';
import * as S from './state.js';
import { PRESETS, loadPreset } from '../presets/index.js';
import { MOVES, LENSES, RATIOS, aspectOf, fovFromMM, mmFromFov, V } from '../engine/camera.js';
import { EASE_LIST } from '../engine/easing.js';
import { ACTION_LIST } from '../engine/figure.js';
import { runAll } from '../engine/checks.js';
import { buildPack } from './promptpack.js';
import { renderVideo } from './exporter.js';

const $ = s => document.querySelector(s);
const el = {};
['projName', 'modeBadge', 'btnAspect', 'btnTheme', 'btnExportJson', 'btnImportJson', 'btnShare', 'btnRender',
 'presetList', 'presetHint', 'statObjects', 'btnAddFigure', 'btnAddProp', 'figureList', 'figAction', 'btnDrawPath',
 'btnClearPath', 'figStart', 'figEnd', 'figSpeed', 'figHeight', 'outline', 'stage', 'canvasHolder', 'hudCam', 'hudMode',
 'emptyTip', 'coach', 'coachText', 'coachClose', 'btnPlay', 'tlTime', 'inpFps', 'selMode', 'inpBlend', 'btnAddShot',
 'tlTrack', 'shotList', 'shotCount', 'shotName', 'shotMove', 'shotDur', 'shotEase', 'shotMmSel', 'shotMm', 'fovRead', 'shotSubject',
 'moveParams', 'shotCue', 'btnShotDup', 'btnShotDel', 'btnViewFree', 'btnViewCam', 'selAspect', 'tgGrid', 'tgFru',
 'tgPath', 'tgGuide', 'checkSummary', 'checkList', 'checkTime', 'btnPack', 'packOut', 'btnPackCopy', 'btnPackDl',
 'saveState', 'jobMask', 'jobTitle', 'jobBar', 'jobLog', 'jobCancel'].forEach(k => { el[k] = document.getElementById(k); });

const KEY_THEME = 'coconut.theme', KEY_COACH = 'coconut.coach';
let project, vp, selShot = -1, selFigure = null, playing = false, playBase = 0, runMode = 'online';
let guide = null, checkTimer = 0, saveTimer = 0;

// ---------- 主题：18:00–07:00 自动深色，手选过就记住 ----------

function autoTheme() { const h = new Date().getHours(); return (h >= 18 || h < 7) ? 'dark' : 'light'; }
function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  localStorage.setItem(KEY_THEME, t);
  if (vp) { vp.setTheme(t); }
}
applyTheme(localStorage.getItem(KEY_THEME) || autoTheme());
el.btnTheme.onclick = () => applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');

// ---------- 启动 ----------

async function boot() {
  project = S.fromHash(location.hash) || S.loadLocal() || S.newProject();
  if (project.version !== S.PROJECT_VERSION) project = Object.assign(S.newProject(), project, { version: S.PROJECT_VERSION });

  vp = new Viewport(el.canvasHolder, { theme: document.documentElement.dataset.theme });
  vp.onSelect = onViewportSelect;
  vp.onPathPoint = p => { const f = curFigure(); if (!f) return; (f.path = f.path || []).push(p); touch(); renderFigures(); };
  vp.onDragFigure = (id, p) => { const f = project.figures.find(x => x.id === id); if (!f) return; f.p = [p[0], f.p[1], p[1]]; touch(); };
  vp.onViewMode = m => setViewButtons(m);
  vp.onPlace = p => addProp(p);
  vp.start();

  runMode = await detectMode();
  el.modeBadge.textContent = runMode === 'local' ? '本地模式 · 可出片' : '在线模式 · 出片受限';
  el.modeBadge.className = 'badge ' + runMode;
  el.btnRender.title = runMode === 'local' ? '逐帧渲染 → 本机 ffmpeg 编码 MP4' : '在线模式只能录 webm（画质与时长按钮走）';

  buildGuides();
  await usePreset(project.preset, true);
  bindUI();
  syncAll();
  S.saveLocal(project) ? setSaveState('已存本机') : setSaveState('本机存不下');
  if (!localStorage.getItem(KEY_COACH)) showCoach(1); else el.coach.classList.add('gone');
  window.__wmReady = true;
  addEventListener('resize', () => { vp.resize(); layoutGuide(); });
}

async function detectMode() {
  try {
    const r = await fetch('/api/ping', { signal: AbortSignal.timeout(1200) });
    return r.ok ? 'local' : 'online';
  } catch (e) { return 'online'; }
}

// ---------- 变更入口 ----------

function touch() {
  clearTimeout(saveTimer);
  setSaveState('保存中…');
  saveTimer = setTimeout(() => { setSaveState(S.saveLocal(project) ? '已存本机 ' + nowHMS() : '存不下（超配额）'); }, 500);
  clearTimeout(checkTimer);
  checkTimer = setTimeout(runChecks, 350);
}
function nowHMS() { return new Date().toTimeString().slice(0, 8); }
function setSaveState(s) { el.saveState.textContent = s; }

async function usePreset(id, keepView) {
  let preset;
  try { preset = await loadPreset(id); }
  catch (e) { toast('预设 ' + id + ' 读不出来：' + e.message); return; }
  project.preset = id;
  vp.setProject(project);
  const built = vp.setPreset(preset);
  vp.frameFromPresetCamera(0);
  el.presetHint.textContent = `${preset.ground ? preset.ground.size.join('×') + ' 米' : '无地面'}`;
  el.statObjects.textContent = built.items.length + ' 件';
  if (!keepView) {
    project.figures = [];
    project.shots = (preset.cameras || []).slice(0, 3).map((c, i) => S.newShot({ pos: c.pos, look: c.look, mm: c.mm }, { n: c.n || ('镜头' + (i + 1)), move: i === 0 ? 'push_in' : 'static', dur: [2, 3, 1.5][i % 3] || 2 }));
    selShot = 0;
  }
  if (!project.shots.length) {
    const c = (preset.cameras || [])[0] || { pos: [4, 1.6, 4], look: [0, 1.1, 0], mm: 35 };
    project.shots = [S.newShot({ pos: c.pos.slice(), look: c.look.slice(), mm: c.mm }, { n: '镜头1' })];
    selShot = 0;
  }
  vp.setProject(project);
  for (const def of (project.customObjects || [])) vp.addObject(def);
  vp.applyTime(vp.t);
  selectShot(0);
  setViewButtons(vp.viewMode);
  syncAll();
  toast('已载入场景：' + (preset.name || id));
}

function syncAll() {
  el.projName.value = project.name;
  el.inpFps.value = project.fps;
  el.selMode.value = project.mode;
  el.inpBlend.value = project.blend;
  el.selAspect.value = project.aspect;
  el.btnAspect.textContent = project.aspect;
  renderPresets(); renderFigures(); renderOutline(); renderShots(); renderTimeline(); runChecks();
  updateShotForm(); updateFigureForm(); layoutGuide();
}

// ---------- 渲染各面板 ----------

function renderPresets() {
  el.presetList.innerHTML = '';
  for (const p of PRESETS) {
    const b = document.createElement('button');
    b.className = 'preset' + (p.id === project.preset ? ' sel' : '');
    b.textContent = p.label;
    b.onclick = () => usePreset(p.id, false);
    el.presetList.appendChild(b);
  }
}

function curFigure() { return project.figures.find(f => f.id === selFigure) || null; }
function curShot() { return project.shots[selShot] || null; }

function renderFigures() {
  el.figureList.innerHTML = '';
  if (!project.figures.length) {
    el.figureList.innerHTML = '<div style="color:var(--ink-3);font-size:12px;padding:4px 2px">还没有人。点上面「加一个人」。</div>';
  }
  project.figures.forEach(f => {
    const d = document.createElement('div');
    d.className = 'item' + (f.id === selFigure ? ' sel' : '');
    d.innerHTML = `<span class="nm">${esc(f.name)}</span><span class="tag">${esc(f.action || 'stand')} · ${f.path && f.path.length > 1 ? f.path.length + '点' : '不走位'}</span><span class="x" title="删除">✕</span>`;
    d.onclick = e => {
      if (e.target.classList.contains('x')) {
        project.figures = project.figures.filter(x => x.id !== f.id);
        if (project.shots.some(s => s.subject === f.id)) project.shots.forEach(s => { if (s.subject === f.id) s.subject = null; });
        selFigure = null; vp.setProject(project); touch(); syncAll(); return;
      }
      selFigure = f.id; vp.setSelected({ type: 'figure', id: f.id }); renderFigures(); updateFigureForm();
    };
    el.figureList.appendChild(d);
  });
}

function updateFigureForm() {
  const f = curFigure();
  ['figAction', 'figStart', 'figEnd', 'figHeight'].forEach(k => { el[k].disabled = !f; });
  el.btnDrawPath.disabled = !f; el.btnClearPath.disabled = !f;
  if (!f) { el.figSpeed.textContent = '先选一个人'; return; }
  el.figAction.value = f.action || 'stand';
  el.figStart.value = f.startT;
  el.figEnd.value = f.endT;
  el.figHeight.value = f.height;
  const v = S.figureSpeed(project, f);
  el.figSpeed.textContent = v ? `${v.toFixed(2)} 米/秒${v > 2.6 ? '（跑）' : v > 0.2 ? '（走）' : ''}` : '不走位';
}

function renderOutline() {
  const items = (vp.built ? vp.built.items : []).filter(i => i.kind !== 'floor' && !i.name.startsWith('__'));
  el.outline.innerHTML = '';
  if (!items.length) { el.outline.innerHTML = '<div style="color:var(--ink-3);font-size:12px">场景是空的</div>'; return; }
  const cap = items.slice(0, 400);
  for (const it of cap) {
    const d = document.createElement('div');
    d.className = 'item' + (vp.selected && vp.selected.type === 'item' && vp.selected.id === it.name ? ' sel' : '');
    d.innerHTML = `<span class="nm">${esc(it.name)}</span><span class="tag">${it.kind}</span>`;
    d.onclick = () => { vp.setSelected({ type: 'item', id: it.name }); vp.focusOn(it.node); renderOutline(); };
    el.outline.appendChild(d);
  }
  if (items.length > cap.length) el.outline.insertAdjacentHTML('beforeend', `<div style="color:var(--ink-3);font-size:11px">还有 ${items.length - cap.length} 件没列出</div>`);
}

function renderShots() {
  el.shotList.innerHTML = '';
  if (!el.shotCount) return;
  project.shots.forEach((s, i) => {
    const d = document.createElement('div');
    d.className = 'item' + (i === selShot ? ' sel' : '');
    const mv = (MOVES.find(m => m.id === s.move) || {}).label || s.move;
    d.innerHTML = `<span class="tag">${i + 1}</span><span class="nm">${esc(s.n)}</span><span class="tag">${mv} · ${s.dur}s · ${s.mm}mm</span>`;
    d.onclick = () => selectShot(i);
    el.shotList.appendChild(d);
  });
  el.shotCount.textContent = `${project.shots.length} 个镜头 / ${S.timeline(project).total.toFixed(1)} 秒`;
}

function selectShot(i) {
  selShot = i;
  vp.selectedShotIndex = i;
  vp.refreshOverlays();
  const tl = S.timeline(project).rows[i];
  if (tl) { vp.t = tl.t0; vp.applyTime(vp.t); }
  renderShots(); renderTimeline(); updateShotForm();
}

function updateShotForm() {
  const s = curShot();
  const fields = ['shotName', 'shotMove', 'shotDur', 'shotEase', 'shotMmSel', 'shotMm', 'shotSubject', 'shotCue'];
  fields.forEach(k => { el[k].disabled = !s; });
  if (!s) { el.moveParams.innerHTML = ''; el.fovRead.textContent = '—'; return; }
  el.shotName.value = s.n;
  el.shotMove.value = s.move;
  el.shotDur.value = s.dur;
  el.shotEase.value = s.ease;
  el.shotMm.value = s.mm;
  el.shotMmSel.value = String(s.mm);
  el.shotCue.value = s.cue || '';
  el.fovRead.textContent = fovFromMM(s.mm, aspectOf(project.aspect)).toFixed(1) + '°';
  el.shotSubject.innerHTML = '<option value="">不跟随</option>' + project.figures.map(f => `<option value="${f.id}"${s.subject === f.id ? ' selected' : ''}>${esc(f.name)}</option>`).join('');
  el.moveParams.innerHTML = '';
  const mv = MOVES.find(m => m.id === s.move);
  (mv && mv.params || []).forEach(p => {
    const row = document.createElement('div');
    row.className = 'row';
    row.innerHTML = `<label>${p.l}</label><input type="number" step="0.1" value="${(s.params && s.params[p.k] != null ? s.params[p.k] : p.d)}" data-k="${p.k}">`;
    row.querySelector('input').oninput = e => { s.params = s.params || {}; s.params[p.k] = Number(e.target.value); touch(); renderTimeline(); };
    el.moveParams.appendChild(row);
  });
}

function renderTimeline() {
  const tl = S.timeline(project);
  el.tlTrack.innerHTML = '';
  if (!tl.rows.length) { el.tlTrack.innerHTML = '<div style="padding:8px;color:var(--ink-3);font-size:12px">还没有镜头，点右下「＋ 从当前视角加机位」</div>'; el.tlTime.textContent = '0.00s / 0.00s'; return; }
  tl.rows.forEach(r => {
    const d = document.createElement('div');
    d.className = 'shot-block' + (r.i === selShot ? ' cur' : '');
    d.style.flex = String(r.dur);
    d.textContent = `${r.i + 1}·${r.dur}s`;
    d.title = project.shots[r.i].n + '（' + ((MOVES.find(m => m.id === project.shots[r.i].move) || {}).label || '') + '）';
    d.onclick = () => selectShot(r.i);
    el.tlTrack.appendChild(d);
  });
  const ph = document.createElement('div');
  ph.id = 'playhead';
  ph.style.left = (100 * (vp.t / tl.total)) + '%';
  el.tlTrack.appendChild(ph);
  el.tlTime.textContent = `${vp.t.toFixed(2)}s / ${tl.total.toFixed(2)}s`;
  el.hudCam.innerHTML = camReadout();
}

function camReadout() {
  if (!project.shots.length) return '';
  const c = S.cameraAt(project, vp.t);
  const s = curShot();
  const fov = fovFromMM(c.mm, aspectOf(project.aspect));
  return `t ${vp.t.toFixed(2)}s ${(s && s.n) || ''}<br>pos ${c.pos.map(v => v.toFixed(2)).join(' / ')}<br>${c.mm.toFixed(0)}mm · FOV ${fov.toFixed(1)}° · ${project.aspect}`;
}

// ---------- 体检 ----------

function runChecks() {
  if (!vp.built || !vp.preset) return;
  const out = runAll(vp.preset, vp.built.items, vp.built.root, project.shots);
  const errs = out.filter(f => f.lvl === 'err'), warns = out.filter(f => f.lvl === 'warn');
  el.checkTime.textContent = '用时 ' + new Date().toTimeString().slice(0, 8);
  el.checkSummary.innerHTML = `<span>阻断 <b style="color:var(--err)">${errs.length}</b></span><span>提醒 <b style="color:var(--warn)">${warns.length}</b></span><span>${out.length ? '' : '✓ 没发现问题'}</span>`;
  el.checkList.innerHTML = '';
  if (!out.length) {
    el.checkList.innerHTML = '<div class="finding ok"><span class="ic">✓</span><span>结构、机位、镜头连续性都过了</span></div>';
  }
  for (const f of out.slice(0, 60)) {
    const d = document.createElement('div');
    d.className = 'finding ' + (f.lvl === 'err' ? 'err' : 'warn');
    d.innerHTML = `<span class="ic">${f.lvl === 'err' ? '✕' : '!'}</span><span>${esc(f.msg)}</span>`;
    d.onclick = () => jumpToFinding(f);
    el.checkList.appendChild(d);
  }
  if (out.length > 60) el.checkList.insertAdjacentHTML('beforeend', `<div style="color:var(--ink-3);font-size:11px">另有 ${out.length - 60} 条</div>`);
}

function jumpToFinding(f) {
  const name = f.who;
  if (!name) return;
  if (name.includes('/')) { const a = name.split('/'); selectShot(project.shots.findIndex(s => s.n === a[0])); return; }
  if (project.figures.some(x => x.name === name)) { const x = project.figures.find(y => y.name === name); selFigure = x.id; vp.setSelected({ type: 'figure', id: x.id }); vp.focusOn(vp.selectedNode()); renderFigures(); updateFigureForm(); return; }
  const it = vp.built.items.find(i => i.name === name);
  if (it) { vp.setSelected({ type: 'item', id: name }); vp.focusOn(it.node); renderOutline(); }
}

// ---------- 播放 ----------

function setPlaying(on) {
  playing = on;
  el.btnPlay.textContent = on ? '❚❚' : '▶';
  if (on) {
    const total = S.timeline(project).total || 1;
    if (vp.t >= total - 0.001) vp.t = 0;
    playBase = performance.now() - vp.t * 1000;
  } else vp.t = vp.t;
}
function playTick() {
  if (playing) {
    const total = S.timeline(project).total || 1;
    vp.t = ((performance.now() - playBase) / 1000) % total;
    vp.applyTime(vp.t);
    renderTimeline();
    const r = S.timeline(project).rows.find(x => vp.t >= x.t0 && vp.t < x.t1);
    if (r && r.i !== selShot) { selShot = r.i; renderShots(); updateShotForm(); }
  }
  requestAnimationFrame(playTick);
}

// ---------- 人物 / 道具 ----------

function addFigure() {
  const c = S.cameraAt(project, vp.t);
  const f = S.newFigure({ name: '人物' + (project.figures.length + 1), p: [c.look[0], 0, c.look[2]] });
  project.figures.push(f);
  selFigure = f.id;
  vp.setProject(project);
  vp.setSelected({ type: 'figure', id: f.id });
  touch(); renderFigures(); updateFigureForm(); renderOutline(); showCoach(3);
}
function addProp(p) {
  const n = '方块' + (project.customObjects ? project.customObjects.length + 1 : 1);
  project.customObjects = project.customObjects || [];
  const def = { t: 'box', n, p: [p[0], 0.3, p[1]], s: [0.6, 0.6, 0.6], m: 'accent' };
  project.customObjects.push(def);
  vp.addObject(def);
  touch(); renderOutline(); toast('已放一个方块：' + n);
}

// ---------- 出片任务 ----------

async function doRender() {
  el.jobMask.classList.remove('hidden');
  el.jobTitle.textContent = runMode === 'local' ? '逐帧出片中（本机 ffmpeg）' : '在线模式：只能录 webm';
  el.jobBar.firstElementChild.style.width = '0%';
  const log = m => { el.jobLog.textContent = m; };
  try {
    const res = await renderVideo({ project, vp, mode: runMode, log, fps: project.fps, aspect: project.aspect });
    log(res.note || '完成');
    toast(runMode === 'local' ? '出片完成：' + res.file : '已录好 webm，去下载');
  } catch (e) {
    log('失败：' + e.message);
    toast('出片失败：' + e.message.slice(0, 60));
  } finally {
    setTimeout(() => el.jobMask.classList.add('hidden'), 900);
  }
}

// ---------- 绑定 ----------

function bindUI() {
  el.projName.oninput = () => { project.name = el.projName.value; touch(); };
  el.inpFps.onchange = () => { project.fps = Math.max(12, Math.min(60, Number(el.inpFps.value) || 25)); touch(); };
  el.selMode.onchange = () => { project.mode = el.selMode.value; touch(); };
  el.inpBlend.onchange = () => { project.blend = Number(el.inpBlend.value) || 0; touch(); };

  el.btnAddFigure.onclick = addFigure;
  el.btnAddProp.onclick = () => { vp.setDragMode(vp.dragMode === 'place' ? 'none' : 'place'); toast(vp.dragMode === 'place' ? '在地面上点一下放方块' : '已退出摆放'); };
  el.figAction.onchange = () => { const f = curFigure(); if (!f) return; f.action = el.figAction.value; vp.applyTime(vp.t); touch(); renderFigures(); };
  el.figStart.onchange = () => { const f = curFigure(); if (f) { f.startT = Number(el.figStart.value) || 0; touch(); updateFigureForm(); } };
  el.figEnd.onchange = () => { const f = curFigure(); if (f) { f.endT = Number(el.figEnd.value) || 1; touch(); updateFigureForm(); } };
  el.figHeight.onchange = () => { const f = curFigure(); if (f) { f.height = Number(el.figHeight.value) || 1.75; vp.setProject(project); touch(); } };
  el.btnDrawPath.onclick = () => { if (!curFigure()) return toast('先选一个人'); vp.setDragMode(vp.dragMode === 'drawPath' ? 'none' : 'drawPath'); toast(vp.dragMode === 'drawPath' ? '在地面上依次点，点完按 Esc' : '已停止画线'); };
  el.btnClearPath.onclick = () => { const f = curFigure(); if (f) { f.path = []; vp.setProject(project); touch(); renderFigures(); } };

  el.btnAddShot.onclick = () => {
    const v = vp.snapshotViewAsShot(curShot() ? curShot().mm : 35);
    const s = S.newShot(v, { n: '镜头' + (project.shots.length + 1), move: project.shots.length ? 'static' : 'push_in' });
    project.shots.push(s); touch(); selectShot(project.shots.length - 1); syncAll(); showCoach(4);
  };
  el.shotName.oninput = () => { const s = curShot(); if (s) { s.n = el.shotName.value; touch(); renderShots(); renderTimeline(); } };
  el.shotMove.onchange = () => { const s = curShot(); if (s) { s.move = el.shotMove.value; s.params = {}; touch(); updateShotForm(); renderShots(); renderTimeline(); } };
  el.shotDur.onchange = () => { const s = curShot(); if (s) { s.dur = Math.max(0.2, Number(el.shotDur.value) || 2); touch(); renderShots(); renderTimeline(); } };
  el.shotEase.onchange = () => { const s = curShot(); if (s) { s.ease = el.shotEase.value; touch(); } };
  el.shotMm.oninput = () => { const s = curShot(); if (s) { s.mm = Number(el.shotMm.value); el.shotMmSel.value = String(nearestLens(s.mm)); el.fovRead.textContent = fovFromMM(s.mm, aspectOf(project.aspect)).toFixed(1) + '°'; touch(); renderShots(); } };
  el.shotMmSel.onchange = () => { const s = curShot(); if (s) { s.mm = Number(el.shotMmSel.value); el.shotMm.value = s.mm; el.fovRead.textContent = fovFromMM(s.mm, aspectOf(project.aspect)).toFixed(1) + '°'; touch(); renderShots(); } };
  el.shotSubject.onchange = () => { const s = curShot(); if (s) { s.subject = el.shotSubject.value || null; touch(); } };
  el.shotCue.oninput = () => { const s = curShot(); if (s) { s.cue = el.shotCue.value; touch(); } };
  el.btnShotDup.onclick = () => { const s = curShot(); if (!s) return; const c = JSON.parse(JSON.stringify(s)); c.id = 's' + Math.random().toString(36).slice(2, 7); c.n = s.n + ' 副本'; project.shots.splice(selShot + 1, 0, c); touch(); selectShot(selShot + 1); syncAll(); };
  el.btnShotDel.onclick = () => { if (!project.shots.length) return; project.shots.splice(selShot, 1); selShot = Math.max(0, selShot - 1); touch(); syncAll(); selectShot(selShot); };

  el.btnViewFree.onclick = () => { vp.viewMode = 'free'; setViewButtons('free'); };
  el.btnViewCam.onclick = () => { vp.viewMode = 'cam'; setViewButtons('cam'); };
  el.selAspect.onchange = () => { project.aspect = el.selAspect.value; vp.aspect = project.aspect; el.btnAspect.textContent = project.aspect; vp.refreshOverlays(); layoutGuide(); touch(); updateShotForm(); };
  el.btnAspect.onclick = () => {
    const i = RATIOS.findIndex(r => r.id === project.aspect);
    project.aspect = RATIOS[(i + 1) % RATIOS.length].id;
    el.selAspect.value = project.aspect; el.btnAspect.textContent = project.aspect;
    vp.aspect = project.aspect; vp.refreshOverlays(); layoutGuide(); touch(); updateShotForm();
  };
  [['tgGrid', 'grid'], ['tgFru', 'frustums'], ['tgPath', 'paths'], ['tgGuide', '__guide']].forEach(([id, key]) => {
    el[id].onclick = () => {
      if (key === '__guide') { guide.classList.toggle('hidden'); el[id].classList.toggle('on'); return; }
      vp.show[key] = !vp.show[key]; el[id].classList.toggle('on', vp.show[key]); vp.refreshOverlays();
    };
  });

  el.btnPlay.onclick = () => setPlaying(!playing);
  el.tlTrack.onpointerdown = e => {
    const r = el.tlTrack.getBoundingClientRect();
    const total = S.timeline(project).total || 1;
    const seek = px => { vp.t = Math.max(0, Math.min(total, ((px - r.left) / r.width) * total)); vp.applyTime(vp.t); renderTimeline(); };
    seek(e.clientX);
    const mv = ev => seek(ev.clientX), up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); };
    addEventListener('pointermove', mv); addEventListener('pointerup', up);
  };

  el.btnPack.onclick = showPack;
  el.btnPackCopy.onclick = async () => { try { await navigator.clipboard.writeText(el.packOut.textContent); toast('已复制'); } catch (e) { toast('浏览器不让直接复制，手选一遍吧'); } };
  el.btnPackDl.onclick = () => S.download(`${project.name || '椰子工作台'}_提示词包.md`, el.packOut.textContent, 'text/markdown');
  el.btnRender.onclick = doRender;
  el.jobCancel.onclick = () => { window.__cancelRender = true; };

  el.btnExportJson.onclick = () => S.download(`${project.name || 'project'}.coco.json`, JSON.stringify(project, null, 2), 'application/json');
  el.btnImportJson.onclick = () => {
    const i = document.createElement('input'); i.type = 'file'; i.accept = '.json,application/json';
    i.onchange = async () => {
      try {
        const p = JSON.parse(await i.files[0].text());
        project = Object.assign(S.newProject(), p);
        await usePreset(project.preset, true); syncAll(); touch(); toast('工程已导入');
      } catch (e) { toast('这个 JSON 读不了：' + e.message.slice(0, 50)); }
    };
    i.click();
  };
  el.btnShare.onclick = () => {
    const h = S.toHash(project);
    if (h.length > 60000) return toast('工程太大（' + (h.length / 1024 | 0) + 'KB），超了浏览器地址栏限制，改用导出 JSON');
    location.hash = h.slice(1);
    navigator.clipboard && navigator.clipboard.writeText(location.href);
    toast('链接已复制（工程整个塞在网址里）');
  };
  el.coachClose.onclick = () => { el.coach.classList.add('gone'); localStorage.setItem(KEY_COACH, 'off'); };

  addEventListener('keydown', e => {
    if (/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
    if (e.code === 'Space') { e.preventDefault(); setPlaying(!playing); }
    if (e.code === 'KeyC' && (e.ctrlKey || e.metaKey) && vp.viewMode === 'cam') { /* 留位：截图 */ }
  });
  playTick();
}

function setViewButtons(m) {
  el.btnViewFree.classList.toggle('on', m === 'free');
  el.btnViewCam.classList.toggle('on', m === 'cam');
}
function onViewportSelect(sel) {
  if (sel && sel.type === 'figure') { selFigure = sel.id; renderFigures(); updateFigureForm(); }
  renderOutline();
}

// ---------- 画幅安全框 ----------

function buildGuides() {
  guide = document.createElement('div');
  guide.id = 'frameGuide';
  guide.innerHTML = '<div class="safe"></div><div class="title"></div>';
  el.stage.appendChild(guide);
  layoutGuide();
}
function layoutGuide() {
  if (!guide || !vp) return;
  const holder = el.canvasHolder.getBoundingClientRect();
  const stage = el.stage.getBoundingClientRect();
  const a = aspectOf(project ? project.aspect : '16:9'), wa = holder.width / holder.height;
  let w = holder.width, h = holder.height;
  if (a > wa) h = w / a; else w = h * a;
  guide.style.left = (holder.left - stage.left + (holder.width - w) / 2) + 'px';
  guide.style.top = (holder.top - stage.top + (holder.height - h) / 2) + 'px';
  guide.style.width = w + 'px';
  guide.style.height = h + 'px';
}

// ---------- 提示词包 ----------

function showPack() {
  if (!project.shots.length) return toast('先加镜头');
  el.packOut.classList.remove('hidden');
  el.packOut.textContent = buildPack({ project, preset: vp.preset, vp });
  showCoach(5);
}
function collectFindings() {
  if (!vp.built) return [];
  return runAll(vp.preset, vp.built.items, vp.built.root, project.shots).filter(f => f.lvl === 'err');
}

// ---------- 引导 ----------

const COACH_TEXT = {
  1: '左边选一个场景，或加自己的方块',
  2: '点「加一个人」，圆柱身+球头，选好动作',
  3: '选好景别，按「＋ 从当前视角加机位」，再挑运镜',
  4: '按右下「一键出片」，本机 ffmpeg 出 MP4',
  5: '把这段提示词连同白膜视频一起发给即梦/豆包'
};
function showCoach(step) {
  el.coach.classList.remove('gone');
  [...el.coach.querySelectorAll('.step')].forEach(s => s.classList.toggle('act', Number(s.dataset.step) === step));
  el.coachText.textContent = COACH_TEXT[step] || '';
}

function nearestLens(mm) { return (LENSES.reduce((a, b) => Math.abs(b.mm - mm) < Math.abs(a.mm - mm) ? b : a)).mm; }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .3s ease'; }, 1900);
  setTimeout(() => t.remove(), 2400);
}

// 选项灌满
el.figAction.innerHTML = ACTION_LIST.map(a => `<option value="${a.id}">${a.label}</option>`).join('');
el.shotMove.innerHTML = MOVES.map(m => `<option value="${m.id}">${m.label}</option>`).join('');
el.shotEase.innerHTML = EASE_LIST.map(e => `<option value="${e.id}">${e.label}</option>`).join('');
el.shotMmSel.innerHTML = LENSES.map(l => `<option value="${l.mm}">${l.label}</option>`).join('');
el.selAspect.innerHTML = RATIOS.map(r => `<option value="${r.id}">${r.label}</option>`).join('');
void V; void mmFromFov;

boot();
