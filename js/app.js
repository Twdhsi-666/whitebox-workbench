/* ============================================================
 * 白膜工作台 · 主应用 v2
 * 视图：entry（入口） / editor（白模编辑器） / library（场景库+播放器）
 * ============================================================ */
import { importSceneFile, importProjectJSON } from './importer.js';
import { SceneController } from './player.js';
import { store } from './store.js';
import { EditorApp, EDITOR_SHOT_SIZES } from './editor.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const state = {
  scenes: [],
  activeId: null,
  view: 'entry',        // entry | editor | library
  search: '',
};

let player = null;          // 详情面板播放器
let statePoller = null;
let thumbQueue = Promise.resolve();
let editor = null;          // 白模编辑器实例
let editorRec = null;       // 正在编辑的场景记录（null=新建）
let lastSavedJSON = null;   // 上次保存/载入的序列化快照，用于返回时脏检查
let drawerCat = null;

/* ------------------------------------------------------------ */
/* 工具                                                          */
/* ------------------------------------------------------------ */
function fmtTime(t) {
  if (t == null || !isFinite(t)) return '--:--';
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${String(m).padStart(2, '0')}:${s.toFixed(1).padStart(4, '0')}`;
}
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function toast(msg, type = 'ok', ms = 3600) {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  $('#toasts').appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, ms);
}
function download(name, content, mime = 'text/plain;charset=utf-8') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type: mime }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
function persist() {
  const r = store.save(state.scenes);
  if (!r.ok) toast('本地存储已满，本次导入的场景刷新后会丢失', 'warn', 6000);
}
function isNative(rec) { return rec.type === 'native'; }
function sceneTitle(rec) { return isNative(rec) ? rec.title : (rec.manifest.title || '未命名'); }
function envName(id) {
  const e = (window.WB_ENVIRONMENTS || []).find(x => x.id === id);
  return e ? e.name : '空房间';
}
function sceneSub(rec) {
  if (isNative(rec)) {
    const n = (rec.data.objects || []).length;
    return `白模 · ${envName(rec.data.env)} · ${n} 个资产`;
  }
  return `${rec.manifest.author || '无'}${rec.manifest.duration ? ' · ' + rec.manifest.duration + 's' : ''}`;
}

/* ------------------------------------------------------------ */
/* 视图路由                                                      */
/* ------------------------------------------------------------ */
function switchView(name) {
  state.view = name;
  $('#view-entry').hidden = name !== 'entry';
  $('#view-editor').hidden = name !== 'editor';
  $('#view-library').hidden = name !== 'library';
  if (name === 'library') {
    renderAll();
  }
  if (name !== 'editor' && editor) { /* 编辑器保活，返回时继续 */ }
}

/* ------------------------------------------------------------ */
/* 入口：星空 + 预设 + 我的场景                                  */
/* ------------------------------------------------------------ */
const ENV_PREVIEWS = {
  room: '<svg viewBox="0 0 160 92"><rect x="18" y="26" width="124" height="52" fill="none" stroke="#ffd250" stroke-width="1.4" opacity=".85"/><rect x="30" y="40" width="26" height="24" fill="#ffd250" opacity=".18" stroke="#ffd250" stroke-width="1"/><rect x="104" y="40" width="26" height="24" fill="#ffd250" opacity=".18" stroke="#ffd250" stroke-width="1"/><path d="M18 78 L242 78" stroke="#ffd250" stroke-width="1" opacity=".3"/><path d="M74 26 L74 78 M86 26 L86 78" stroke="#ffd250" stroke-width=".7" opacity=".35"/></svg>',
  street: '<svg viewBox="0 0 160 92"><path d="M20 84 L60 30 L100 30 L140 84" fill="none" stroke="#ffd250" stroke-width="1.3" opacity=".8"/><path d="M64 34 L64 84 M96 34 L96 84" stroke="#ffd250" stroke-width=".7" opacity=".4"/><rect x="22" y="20" width="20" height="34" fill="#ffd250" opacity=".14" stroke="#ffd250" stroke-width="1"/><rect x="118" y="14" width="24" height="40" fill="#ffd250" opacity=".14" stroke="#ffd250" stroke-width="1"/><rect x="46" y="46" width="16" height="12" fill="#ffd250" opacity=".2"/><rect x="98" y="42" width="16" height="12" fill="#ffd250" opacity=".2"/></svg>',
  temple: '<svg viewBox="0 0 160 92"><path d="M80 12 L128 40 L32 40 Z" fill="#ffd250" opacity=".16" stroke="#ffd250" stroke-width="1.2"/><rect x="44" y="40" width="9" height="34" fill="#ffd250" opacity=".22" stroke="#ffd250" stroke-width=".9"/><rect x="107" y="40" width="9" height="34" fill="#ffd250" opacity=".22" stroke="#ffd250" stroke-width=".9"/><rect x="56" y="52" width="9" height="22" fill="#ffd250" opacity=".22" stroke="#ffd250" stroke-width=".9"/><rect x="95" y="52" width="9" height="22" fill="#ffd250" opacity=".22" stroke="#ffd250" stroke-width=".9"/><path d="M14 74 L146 74" stroke="#ffd250" stroke-width="1.2" opacity=".6"/><path d="M30 74 L30 68 M130 74 L130 68" stroke="#ffd250" stroke-width="1" opacity=".6"/></svg>',
  office: '<svg viewBox="0 0 160 92"><rect x="20" y="24" width="120" height="8" fill="#ffd250" opacity=".2" stroke="#ffd250" stroke-width="1"/><rect x="32" y="44" width="26" height="14" fill="#ffd250" opacity=".14" stroke="#ffd250" stroke-width=".9"/><rect x="67" y="44" width="26" height="14" fill="#ffd250" opacity=".14" stroke="#ffd250" stroke-width=".9"/><rect x="102" y="44" width="26" height="14" fill="#ffd250" opacity=".14" stroke="#ffd250" stroke-width=".9"/><rect x="38" y="32" width="14" height="10" fill="#ffd250" opacity=".28"/><rect x="73" y="32" width="14" height="10" fill="#ffd250" opacity=".28"/><rect x="108" y="32" width="14" height="10" fill="#ffd250" opacity=".28"/><rect x="32" y="64" width="26" height="12" fill="#ffd250" opacity=".1" stroke="#ffd250" stroke-width=".8"/><rect x="102" y="64" width="26" height="12" fill="#ffd250" opacity=".1" stroke="#ffd250" stroke-width=".8"/></svg>',
  wild: '<svg viewBox="0 0 160 92"><path d="M0 70 Q40 52 80 62 T160 54 L160 92 L0 92 Z" fill="#ffd250" opacity=".1" stroke="#ffd250" stroke-width="1" opacity=".5"/><path d="M56 62 L56 40 M56 44 L46 36 M56 50 L66 42 M56 38 L52 30 M56 38 L60 30" stroke="#ffd250" stroke-width="1.3"/><circle cx="56" cy="30" r="9" fill="#ffd250" opacity=".18" stroke="#ffd250" stroke-width="1.1"/><ellipse cx="112" cy="72" rx="13" ry="8" fill="#ffd250" opacity=".18" stroke="#ffd250" stroke-width="1"/><ellipse cx="128" cy="76" rx="8" ry="5" fill="#ffd250" opacity=".12" stroke="#ffd250" stroke-width=".8"/><circle cx="24" cy="20" r="7" fill="#ffd250" opacity=".3"/></svg>',
  studio: '<svg viewBox="0 0 160 92"><path d="M10 84 Q10 26 80 26 Q150 26 150 84" fill="none" stroke="#ffd250" stroke-width="1.3" opacity=".8"/><path d="M10 84 Q80 70 150 84" fill="none" stroke="#ffd250" stroke-width=".8" opacity=".4"/><ellipse cx="80" cy="84" rx="22" ry="5" fill="#ffd250" opacity=".16" stroke="#ffd250" stroke-width=".9"/><circle cx="80" cy="52" r="4" fill="#ffd250" opacity=".5"/></svg>',
};

function initStarfield() {
  const cv = $('#starfield'), ctx = cv.getContext('2d');
  let stars = [], w = 0, h = 0;
  const resize = () => {
    w = cv.width = innerWidth * devicePixelRatio;
    h = cv.height = innerHeight * devicePixelRatio;
    stars = Array.from({ length: 240 }, () => ({
      x: Math.random() * w, y: Math.random() * h,
      r: (Math.random() * 1.1 + 0.3) * devicePixelRatio,
      p: Math.random() * Math.PI * 2,
      s: 0.4 + Math.random() * 1.2,
    }));
  };
  resize();
  addEventListener('resize', resize);
  let t = 0;
  (function draw() {
    if ($('#view-entry').hidden) return requestAnimationFrame(draw);
    t += 0.016;
    ctx.clearRect(0, 0, w, h);
    for (const s of stars) {
      const a = 0.25 + 0.55 * (0.5 + 0.5 * Math.sin(t * s.s + s.p));
      ctx.globalAlpha = a;
      ctx.fillStyle = '#cdd6ea';
      ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, 7); ctx.fill();
    }
    ctx.globalAlpha = 1;
    requestAnimationFrame(draw);
  })();
}

function renderEntry() {
  const eg = $('#envGrid');
  eg.innerHTML = (window.WB_ENVIRONMENTS || []).map(e => `
    <button class="env-card" data-env="${e.id}">
      <span class="env-prev">${ENV_PREVIEWS[e.id] || ''}</span>
      <span class="env-info">
        <span class="env-name">${e.name}</span>
        <span class="env-desc">${e.desc}</span>
      </span>
    </button>`).join('');
  eg.onclick = (ev) => {
    const c = ev.target.closest('[data-env]');
    if (c) openEditor({ env: c.dataset.env });
  };

  const mg = $('#mineGrid');
  const scenes = state.scenes;
  $('#enCount').textContent = `${scenes.length} 个`;
  if (!scenes.length) {
    mg.innerHTML = `<div class="mine-empty">还没有场景 —— 点上方「导入白膜 HTML」，或从预设环境新建一个</div>`;
  } else {
    mg.innerHTML = scenes.map(s => `
      <button class="mine-card" data-id="${s.id}">
        <span class="mine-thumb">
          ${s.thumb ? `<img src="${s.thumb}" alt="">` : '<span class="ph">◍</span>'}
          <span class="mine-badge ${isNative(s) ? 'native' : ''}">${isNative(s) ? '白模场景' : (s.tier === 'A' ? '规范 HTML' : '兼容 HTML')}</span>
        </span>
        <span class="mine-body">
          <span class="mine-title">${esc(sceneTitle(s))}</span>
          <span class="mine-sub">${esc(sceneSub(s))}</span>
        </span>
      </button>`).join('');
  }
  mg.onclick = (ev) => {
    const c = ev.target.closest('[data-id]');
    if (c) openScene(c.dataset.id);
  };
}

/* ------------------------------------------------------------ */
/* 白模编辑器                                                    */
/* ------------------------------------------------------------ */
const RAIL_ICONS = {
  person: '<svg viewBox="0 0 24 24" width="17" height="17"><path d="M12 4a2.2 2.2 0 100 4.4A2.2 2.2 0 0012 4zm0 5.6c-2.2 0-4 1.4-4 3.2V16h2v5h1.5v-5h1v5H14v-5h2v-3.2c0-1.8-1.8-3.2-4-3.2z" fill="currentColor"/></svg>',
  car: '<svg viewBox="0 0 24 24" width="17" height="17"><path d="M5 11l1.5-4h11L19 11v5h-2v-2H7v2H5v-5zm2.2-1h9.6l.6 1.5H6.6L7.2 10zM7 14a1.2 1.2 0 100 2.4A1.2 1.2 0 007 14zm10 0a1.2 1.2 0 100 2.4 1.2 1.2 0 000-2.4z" fill="currentColor"/></svg>',
  building: '<svg viewBox="0 0 24 24" width="17" height="17"><path d="M4 3h9v18H4V3zm2 2v3h2V5H6zm4 0v3h2V5h-2zM6 10h2v3H6v-3zm4 0h2v3h-2v-3zM6 15h2v3H6v-3zm4 0h2v3h-2v-3zM14 8h6v13h-6V8zm2 2v2h2v-2h-2zm0 4v2h2v-2h-2zm0 4v2h2v-2h-2z" fill="currentColor"/></svg>',
  tree: '<svg viewBox="0 0 24 24" width="17" height="17"><path d="M12 2L7 9h2.5l-3.5 5h4l-3 4h4v4h2v-4h4l-3-4h4l-3.5-5H17L12 2z" fill="currentColor"/></svg>',
  cube: '<svg viewBox="0 0 24 24" width="17" height="17"><path d="M12 2l9 5v10l-9 5-9-5V7l9-5zm0 2.3L5.5 8 12 11.7 18.5 8 12 4.3zM5 9.8v6.4l6 3.3v-6.4l-6-3.3zm14 0l-6 3.3v6.4l6-3.3V9.8z" fill="currentColor"/></svg>',
};

const EDITOR_COLORS = ['#f2efe8', '#e3dfd4', '#c9c5b8', '#d4882a', '#c2533f', '#4a7db8', '#4e8d6e', '#23262d'];

function openEditor(opts) {
  opts = opts || {};
  switchView('editor');
  if (editor) { editor.dispose(); editor = null; }
  const vp = $('#edViewport');
  vp.querySelectorAll('canvas').forEach(c => c.remove());
  editorRec = state.scenes.find(s => s.id === opts.recId) || null;

  editor = new EditorApp(vp, {
    onSelect: () => renderInspector(),
    onStatus: (m) => toast(m, 'ok', 2400),
    onCams: () => renderCams(),
  });

  if (editorRec) {
    editor.loadScene(editorRec.data);
    $('#edName').value = editorRec.title;
    $('#edEnvBadge').textContent = envName(editorRec.data.env);
  } else {
    editor.loadEnv(opts.env || 'room');
    $('#edName').value = '';
    $('#edName').placeholder = '未命名场景';
    $('#edEnvBadge').textContent = envName(opts.env || 'room');
  }
  buildRail();
  buildShots();
  renderCams();
  renderInspector();
  closeDrawer();
  lastSavedJSON = JSON.stringify(editor.serialize());  // 脏检查基准快照
}

function closeEditor() {
  switchView('entry');
  renderEntry();
}

function saveEditor() {
  const title = ($('#edName').value || '').trim() || '未命名场景';
  let thumb = null;
  try { thumb = editor.captureThumb(320, 180); } catch (e) { /* 截图失败不阻塞保存 */ }
  if (editorRec) {
    editorRec.data = editor.serialize();
    editorRec.title = title;
    if (thumb) editorRec.thumb = thumb;
  } else {
    editorRec = {
      id: 'sc_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      type: 'native', title, data: editor.serialize(),
      thumb, createdAt: Date.now(),
    };
    state.scenes.unshift(editorRec);
  }
  persist();
  renderEntry(); renderLibrary(); renderGrid();
  lastSavedJSON = JSON.stringify(editorRec.data);
  toast('已保存「' + title + '」');
}

function buildRail() {
  const rail = $('#edRail');
  rail.innerHTML = (window.WB_ASSET_CATS || []).map(c =>
    `<button data-cat="${c.id}" title="${c.name}">${RAIL_ICONS[c.icon] || RAIL_ICONS.cube}</button>`).join('');
  rail.onclick = (ev) => {
    const b = ev.target.closest('[data-cat]');
    if (!b) return;
    if (drawerCat === b.dataset.cat && !$('#edDrawer').hidden) closeDrawer();
    else openDrawer(b.dataset.cat);
  };
}

function openDrawer(cat) {
  drawerCat = cat;
  $$('#edRail button').forEach(b => b.classList.toggle('active', b.dataset.cat === cat));
  $('#edDrawer').hidden = false;
  renderAssetGrid('');
  $('#edAssetSearch').value = '';
  $('#edAssetSearch').focus();
}
function closeDrawer() {
  drawerCat = null;
  $('#edDrawer').hidden = true;
  $$('#edRail button').forEach(b => b.classList.remove('active'));
}

async function renderAssetGrid(q) {
  const grid = $('#edAssetGrid');
  const list = (window.WB_ASSETS || []).filter(a =>
    a.cat === drawerCat && (!q || a.name.includes(q) || a.id.includes(q.toLowerCase())));
  if (!list.length) {
    grid.innerHTML = '<div style="grid-column:1/-1;color:var(--ed-text3);font-size:11px;text-align:center;padding:20px 0;">没有匹配的资产</div>';
    return;
  }
  grid.innerHTML = list.map(a =>
    `<button class="ed-asset" data-a="${a.id}"><span class="ed-asset-img" data-a="${a.id}"></span><span class="ed-asset-name">${a.name}</span></button>`).join('');
  grid.onclick = (ev) => {
    const b = ev.target.closest('[data-a]');
    if (b) editor.addAsset(b.dataset.a);
  };
  if (!window.__WB_THUMBS) {
    grid.querySelectorAll('.ed-asset-img').forEach(el => {
      el.innerHTML = '<span style="color:var(--ed-text3);font-size:10px;">渲染中…</span>';
    });
    const thumbs = await EditorApp.makeAssetThumbs();
    if (!drawerCat) return;
    renderAssetGrid(q);
  } else {
    grid.querySelectorAll('.ed-asset-img').forEach(el => {
      el.innerHTML = `<img src="${window.__WB_THUMBS[el.dataset.a]}" alt="">`;
    });
  }
}

function buildShots() {
  const box = $('#edShots');
  box.innerHTML = EDITOR_SHOT_SIZES.map(s =>
    `<button data-s="${s.id}" title="${s.name}">${s.name}</button>`).join('');
  box.onclick = (ev) => {
    const b = ev.target.closest('[data-s]');
    if (!b) return;
    $$('#edShots button').forEach(x => x.classList.toggle('active', x === b));
    editor.setShotSize(b.dataset.s);
  };
}

function renderCams() {
  const box = $('#edCams');
  const add = '<button class="ed-chip add" id="edAddCam">＋ 保存机位</button>';
  box.innerHTML = (editor ? editor.cams : []).map((c, i) =>
    `<span class="ed-chip" data-cam="${i}" title="飞到此机位">${c.name}</span>`).join('') + add;
  $('#edAddCam').onclick = () => editor && editor.saveCam();
  box.querySelectorAll('[data-cam]').forEach(el => {
    el.onclick = () => editor && editor.gotoCam(+el.dataset.cam);
  });
}

function renderInspector() {
  const box = $('#edInspect');
  const rec = editor && editor.selected;
  if (!rec) {
    const def = window.WB_ASSETS.find(a => a.id === (rec && rec.assetId));
    box.innerHTML = `
      <div class="ed-ins-title"><span class="swatch"></span>场景</div>
      <div class="ed-ins-empty">
        环境：<b style="color:var(--ed-text2)">${envName(editor ? editor.envId : 'room')}</b><br>
        已放置资产：<b style="color:var(--ed-text2)">${editor ? editor.objects.length : 0}</b> 个<br>
        机位：<b style="color:var(--ed-text2)">${editor ? editor.cams.length : 0}</b> 个<br><br>
        点击左侧分类添加资产<br>点击场景中的资产进行编辑<br><br>
        <span style="font-size:10.5px">左键旋转 · 滚轮缩放<br>右键/Shift 平移<br>选中后拖动可移动</span>
      </div>
      <div class="ed-ins-title" style="margin-top:18px"><span class="swatch"></span>机位</div>
      <div class="ed-cam-list">
        ${(editor ? editor.cams : []).map((c, i) => `
          <div class="ed-cam-item" data-gocam="${i}">
            <span class="n">${c.name}</span>
            <button class="del" data-delcam="${i}" title="删除机位">×</button>
          </div>`).join('') || '<div class="ed-ins-empty">还没有机位，点底部「＋ 保存机位」</div>'}
      </div>`;
    box.querySelectorAll('[data-gocam]').forEach(el => el.onclick = (e) => {
      if (e.target.dataset.delcam !== undefined) return;
      editor && editor.gotoCam(+el.dataset.gocam);
    });
    box.querySelectorAll('[data-delcam]').forEach(b => b.onclick = (e) => {
      e.stopPropagation();
      editor.cams.splice(+b.dataset.delcam, 1);
      renderCams(); renderInspector();
    });
    return;
  }
  const def = window.WB_ASSETS.find(a => a.id === rec.assetId);
  const g = rec.group;
  const p = g.position;
  box.innerHTML = `
    <div class="ed-ins-title"><span class="swatch"></span>${def ? def.name : '资产'}</div>
    <div class="ed-field"><label>X</label><input type="number" step="0.1" id="insX" value="${p.x.toFixed(2)}"></div>
    <div class="ed-field"><label>Y</label><input type="number" step="0.1" min="0" id="insY" value="${p.y.toFixed(2)}"></div>
    <div class="ed-field"><label>Z</label><input type="number" step="0.1" id="insZ" value="${p.z.toFixed(2)}"></div>
    <div class="ed-field"><label>旋转</label><input type="range" min="0" max="360" step="1" id="insRY" value="${Math.round(g.rotation.y * 180 / Math.PI) % 360}"><span class="val" id="insRYv">${Math.round(g.rotation.y * 180 / Math.PI) % 360}°</span></div>
    <div class="ed-field"><label>缩放</label><input type="range" min="0.3" max="3" step="0.05" id="insS" value="${g.scale.x.toFixed(2)}"><span class="val" id="insSv">${g.scale.x.toFixed(2)}×</span></div>
    <div class="ed-ins-title" style="margin-top:14px"><span class="swatch"></span>涂装</div>
    <div class="ed-colors" id="insColors">
      ${EDITOR_COLORS.map(c => `<button data-c="${c}" style="background:${c}" title="${c}"></button>`).join('')}
    </div>
    <div class="ed-ins-ops">
      <button class="ed-btn" id="insDup">复制一个</button>
      <button class="ed-btn danger" id="insDel">删除</button>
    </div>`;
  const bind = (id, prop, isRange) => {
    const el = $('#' + id);
    el.oninput = () => {
      const v = parseFloat(el.value);
      if (isNaN(v)) return;
      editor.setTransform(prop, v);
      const vEl = $('#' + id + 'v');
      if (vEl) vEl.textContent = (prop === 'ry' ? Math.round(v) + '°' : v.toFixed(2) + (prop === 'scale' ? '×' : ''));
    };
  };
  bind('insX', 'x'); bind('insY', 'y'); bind('insZ', 'z');
  bind('insRY', 'ry', true); bind('insS', 'scale', true);
  $('#insColors').onclick = (ev) => {
    const b = ev.target.closest('[data-c]');
    if (b) { editor.setColor(b.dataset.c); }
  };
  $('#insDel').onclick = () => editor.deleteSelected();
  $('#insDup').onclick = () => {
    const data = editor.serialize().objects.find(o => o.id === rec.assetId);
    if (!data) return;
    const g2 = editor.addAsset(rec.assetId);
    if (g2) {
      g2.group.position.set(p.x + 1.2, p.y, p.z + 1.2);
      g2.group.rotation.y = g.rotation.y;
      editor.select(g2);
    }
  };
}

/* ------------------------------------------------------------ */
/* 场景查询                                                      */
/* ------------------------------------------------------------ */
function visibleScenes() {
  const q = state.search.trim().toLowerCase();
  if (!q) return state.scenes;
  return state.scenes.filter(s =>
    sceneTitle(s).toLowerCase().includes(q) ||
    (!isNative(s) && ((s.manifest.author || '').toLowerCase().includes(q) ||
      (s.manifest.location && s.manifest.location.name || '').toLowerCase().includes(q) ||
      (s.manifest.notes || '').toLowerCase().includes(q))));
}

/* ------------------------------------------------------------ */
/* 渲染：场景库 / 卡片 / 地球                                    */
/* ------------------------------------------------------------ */
function renderLibrary() {
  const list = $('#sceneList');
  const scenes = visibleScenes();
  $('#libCount').textContent = `${scenes.length}/${state.scenes.length}`;
  if (!scenes.length) {
    list.innerHTML = `<div class="lib-empty">${state.scenes.length ? '没有匹配的场景' : '还没有导入场景'}</div>`;
  } else {
    list.innerHTML = scenes.map(s => `
      <div class="lib-item ${s.id === state.activeId ? 'active' : ''}" data-id="${s.id}">
        <div class="lib-thumb">${s.thumb ? `<img src="${s.thumb}" alt="">` : '<span class="lib-thumb-ph">◍</span>'}</div>
        <div class="lib-info">
          <div class="lib-title" title="${esc(sceneTitle(s))}">${esc(sceneTitle(s))}</div>
          <div class="lib-sub">
            ${isNative(s)
              ? `<span class="tier tier-A">白模</span><span>${(s.data.objects || []).length} 资产</span>`
              : `<span class="tier tier-${s.tier}">${s.tier === 'A' ? '规范' : '兼容'}</span><span>${s.manifest.duration ? s.manifest.duration + 's' : '时长待读'}</span>${s.manifest.location ? `<span class="lib-loc">${esc(s.manifest.location.name)}</span>` : ''}`}
          </div>
        </div>
        <button class="lib-del" data-del="${s.id}" title="删除">×</button>
      </div>`).join('');
  }
  const htmlScenes = state.scenes.filter(s => !isNative(s));
  const totalDur = htmlScenes.reduce((a, s) => a + (s.manifest.duration || 0), 0);
  $('#stats').innerHTML = `
    <div><b>${state.scenes.length}</b> 个场景（白模 <b>${state.scenes.length - htmlScenes.length}</b> · HTML <b>${htmlScenes.length}</b>）</div>
    <div>HTML 总时长 <b>${totalDur.toFixed(1)}s</b></div>
    <div>规范文件 <b>${htmlScenes.filter(s => s.tier === 'A').length}</b> · 兼容导入 <b>${htmlScenes.filter(s => s.tier !== 'A').length}</b></div>`;
}

function renderGrid() {
  const scenes = visibleScenes();
  $('#gridCards').innerHTML = scenes.map(s => `
    <div class="card ${s.id === state.activeId ? 'active' : ''}" data-id="${s.id}">
      <div class="card-thumb">${s.thumb ? `<img src="${s.thumb}" alt="">` : '<span>◍</span>'}
        ${isNative(s)
          ? '<span class="tier tier-A">白模</span>'
          : `<span class="tier tier-${s.tier}">${s.tier === 'A' ? '规范' : '兼容'}</span><span class="card-dur">${s.manifest.duration ? s.manifest.duration + 's' : ''}</span>`}
      </div>
      <div class="card-body">
        <div class="card-title" title="${esc(sceneTitle(s))}">${esc(sceneTitle(s))}</div>
        <div class="card-sub">${esc(sceneSub(s))}</div>
      </div>
    </div>`).join('') || '<div class="grid-empty">没有匹配的场景</div>';
}

function renderAll() {
  renderLibrary(); renderGrid();
  $('#emptyHint').classList.toggle('hide', state.scenes.length > 0);
}

/* ------------------------------------------------------------ */
/* 详情面板 + 播放器（HTML 场景）                                */
/* ------------------------------------------------------------ */
async function openScene(id) {
  const rec = state.scenes.find(s => s.id === id);
  if (!rec) return;
  if (isNative(rec)) { openEditor({ recId: id }); return; }
  state.activeId = id;
  switchView('library');
  renderLibrary(); renderGrid();

  const detail = $('#detail');
  detail.hidden = false;
  detail.innerHTML = `
    <header class="d-head">
      <div class="d-title-box">
        <div class="d-title" title="${esc(rec.manifest.title)}">${esc(rec.manifest.title)}</div>
        <div class="d-sub">
          <span class="tier tier-${rec.tier}">${rec.tier === 'A' ? '规范文件' : '兼容导入'}</span>
          <span>${esc(rec.manifest.author)}</span>
          <span>${rec.manifest.duration ? rec.manifest.duration + 's' : '时长待读'}</span>
        </div>
      </div>
      <button class="d-close" id="dClose" title="关闭">×</button>
    </header>
    <div class="d-stage" id="dStage">
      <div class="d-loading" id="dLoading">场景加载中…</div>
    </div>
    <div class="d-controls">
      <button class="ctl-play" id="ctlPlay" title="播放/暂停 (空格)">
        <svg viewBox="0 0 24 24" width="16" height="16"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>
      </button>
      <span class="ctl-time" id="ctlTime">00:00.0</span>
      <div class="ctl-track" id="ctlTrack">
        <input type="range" id="ctlScrub" min="0" max="${rec.manifest.duration || 15}" step="0.01" value="0">
        <div class="ctl-ticks" id="ctlTicks"></div>
      </div>
      <select class="ctl-speed" id="ctlSpeed" title="倍速（仅兼容层支持）">
        <option value="0.5">0.5×</option>
        <option value="1" selected>1×</option>
        <option value="2">2×</option>
      </select>
      <button class="ctl-icon" id="ctlGrab" title="截图当前画面">
        <svg viewBox="0 0 24 24" width="15" height="15"><path d="M12 15.2a3.2 3.2 0 100-6.4 3.2 3.2 0 000 6.4z M9 3l-1.6 2H4v15h16V5h-3.4L15 3H9z" fill="currentColor"/></svg>
      </button>
      <button class="ctl-icon" id="ctlFull" title="全屏">
        <svg viewBox="0 0 24 24" width="15" height="15"><path d="M4 4h6v2H6v4H4V4zm10 0h6v6h-2V6h-4V4zM4 14h2v4h4v2H4v-6zm14 0h2v6h-6v-2h4v-4z" fill="currentColor"/></svg>
      </button>
    </div>
    <div class="d-meta">
      <div class="d-meta-row">
        <span class="k">定位</span>
        <span class="v">${rec.manifest.location ? esc(rec.manifest.location.name) + `（${rec.manifest.location.lat}, ${rec.manifest.location.lng}）` : '未定位 · 赤道故事环'}</span>
      </div>
      <div class="d-meta-row"><span class="k">来源</span><span class="v">${esc(rec.originalName)}</span></div>
      <div class="d-meta-row"><span class="k">导入</span><span class="v">${new Date(rec.importedAt).toLocaleString('zh-CN')}</span></div>
      ${rec.manifest.shots && rec.manifest.shots.length ? `
      <div class="d-shots">
        <div class="d-meta-row"><span class="k">分镜</span></div>
        <div class="shot-list">
          ${rec.manifest.shots.map(sh => `<button class="shot" data-t="${sh.t}"><b>${sh.t}s</b> ${esc(sh.label)}</button>`).join('')}
        </div>
      </div>` : ''}
      ${rec.manifest.notes && rec.manifest.notes !== '无' ? `
      <div class="d-meta-row"><span class="k">备注</span><span class="v">${esc(rec.manifest.notes)}</span></div>` : ''}
      <div class="d-ops">
        <button class="op" id="opExport">导出此场景 HTML</button>
        <button class="op danger" id="opDelete">删除场景</button>
      </div>
    </div>`;

  $('#dClose').onclick = closeDetail;

  /* iframe 播放器 */
  const stage = $('#dStage');
  const iframe = document.createElement('iframe');
  iframe.className = 'scene-frame';
  iframe.setAttribute('allowfullscreen', '');
  stage.appendChild(iframe);

  player?.destroy();
  player = new SceneController(iframe, (log) => {
    if (log.type === 'scene-frame-error') toast(`场景运行错误：${log.detail}`, 'err', 6000);
  });
  $('#dLoading').style.display = 'flex';
  const { ready } = await player.load(rec);
  $('#dLoading').style.display = 'none';
  if (!ready.ok) {
    $('#dLoading').style.display = 'flex';
    $('#dLoading').textContent = '场景加载失败：3D 场景未能在 25 秒内就绪';
    $('#dLoading').classList.add('fail');
    return;
  }
  renderLibrary(); // 兼容层可能补全了 duration/shots

  /* 分镜刻度 */
  const ticks = $('#ctlTicks');
  const dur = rec.manifest.duration || 15;
  if (rec.manifest.shots && rec.manifest.shots.length) {
    ticks.innerHTML = rec.manifest.shots.map(sh =>
      `<i style="left:${(sh.t / dur * 100).toFixed(2)}%" title="${sh.t}s ${esc(sh.label)}"></i>`).join('');
  }
  /* 兼容层且读不到时间 → 禁用拖拽 */
  if (rec.tier === 'B' && rec._legacyHasDisplay === false && !(rec.manifest.shots || []).length) {
    $('#ctlScrub').disabled = true;
    $('#ctlScrub').title = '旧文件无法读取时间轴，暂不支持拖拽跳转';
  }

  /* 控件 */
  const playBtn = $('#ctlPlay'), timeEl = $('#ctlTime'), scrub = $('#ctlScrub');
  const setPlayIcon = (playing) => {
    playBtn.innerHTML = playing
      ? '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M6 5h4v14H6zM14 5h4v14h-4z" fill="currentColor"/></svg>'
      : '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>';
  };
  playBtn.onclick = async () => {
    const st = await player.getState();
    if (st.ok && st.playing) { await player.pause(); setPlayIcon(false); }
    else {
      if (st.ok && st.ended) await player.seek(0);   // 播完了再按播放 → 重头开始
      await player.play(); setPlayIcon(true);
    }
  };
  let seekTimer = 0;
  scrub.oninput = () => { timeEl.textContent = fmtTime(parseFloat(scrub.value)); };
  scrub.onchange = async () => {
    clearTimeout(seekTimer);
    const t = parseFloat(scrub.value);
    seekTimer = setTimeout(async () => {
      const r = await player.seek(t);
      if (!r.ok) toast('跳转失败：' + (r.error || '未知错误'), 'err');
    }, 60);
  };
  $('#ctlSpeed').onchange = async (e) => {
    const r = await player.setSpeed(parseFloat(e.target.value));
    if (!r.ok) toast('倍速仅支持兼容层导入的旧文件', 'warn');
  };
  $('#ctlGrab').onclick = async () => {
    const st = await player.getState();
    const t = st.ok && st.t != null ? st.t : 0;
    const url = await player.grab(t);
    if (url) {
      const a = document.createElement('a');
      a.href = url; a.download = `${rec.manifest.title || 'scene'}_${t.toFixed(1)}s.jpg`;
      a.click();
    } else toast('截图失败', 'err');
  };
  $('#ctlFull').onclick = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else stage.requestFullscreen?.();
  };
  $$('.shot', detail).forEach(b => b.onclick = async () => {
    const r = await player.seek(parseFloat(b.dataset.t));
    if (!r.ok) toast('跳转失败：' + (r.error || '未知错误'), 'err');
  });
  $('#opExport').onclick = () => download(`${rec.manifest.title || 'scene'}.html`, rec.html, 'text/html;charset=utf-8');
  $('#opDelete').onclick = (e) => {
    const btn = e.currentTarget;
    if (btn.dataset.confirm) { removeScene(rec.id); closeDetail(); }
    else { btn.dataset.confirm = '1'; btn.textContent = '再点一次确认删除'; setTimeout(() => { delete btn.dataset.confirm; btn.textContent = '删除场景'; }, 3000); }
  };

  /* 状态轮询 */
  clearInterval(statePoller);
  statePoller = setInterval(async () => {
    const st = await player.getState();
    if (!st.ok) return;
    if (st.t != null && document.activeElement !== scrub) {
      scrub.value = Math.min(st.t, dur);
      timeEl.textContent = fmtTime(st.t);
    }
    setPlayIcon(!!st.playing);
  }, 300);

  /* 首帧定位 */
  player.seek(0.2).catch(() => {});
}

function closeDetail() {
  clearInterval(statePoller);
  player?.destroy();
  player = null;
  state.activeId = null;
  $('#detail').hidden = true;
  $('#detail').innerHTML = '';
  renderLibrary(); renderGrid();
}

function removeScene(id) {
  state.scenes = state.scenes.filter(s => s.id !== id);
  if (editorRec && editorRec.id === id) { editorRec = null; }
  persist(); renderAll(); renderEntry();
  toast('场景已删除');
}

/* ------------------------------------------------------------ */
/* 导入                                                          */
/* ------------------------------------------------------------ */
function captureThumb(rec) {
  thumbQueue = thumbQueue.then(async () => {
    if (rec.thumb) return;
    const holder = document.createElement('div');
    holder.style.cssText = 'position:fixed;left:-9999px;top:0;width:640px;height:360px;';
    const iframe = document.createElement('iframe');
    iframe.style.cssText = 'width:640px;height:360px;border:0;';
    holder.appendChild(iframe);
    document.body.appendChild(holder);
    try {
      const ctrl = new SceneController(iframe);
      const { ready } = await ctrl.load(rec);
      if (ready.ok) {
        const t = rec.manifest.duration ? Math.min(0.4, rec.manifest.duration * 0.15) : 0.3;
        rec.thumb = await ctrl.makeThumb(t);
        persist(); renderLibrary(); renderGrid(); renderEntry();
      }
      ctrl.destroy();
    } catch (e) { /* 缩略图失败不阻塞导入 */ }
    finally { holder.remove(); }
  });
  return thumbQueue;
}

async function handleFiles(fileList) {
  const files = [...fileList];
  const report = [];
  let okCount = 0;

  for (const f of files) {
    if (/\.json$/i.test(f.name)) {
      try {
        const r = importProjectJSON(JSON.parse(await f.text()));
        if (r.ok) {
          for (const rec of r.records) { state.scenes.unshift(rec); }
          okCount += r.records.length;
          report.push({ name: f.name, ok: true, msg: `项目导入：${r.records.length} 个场景` });
        } else report.push({ name: f.name, ok: false, msg: r.errors.join('；') });
      } catch (e) { report.push({ name: f.name, ok: false, msg: 'JSON 解析失败：' + e.message }); }
      continue;
    }
    const r = await importSceneFile(f);
    if (r.ok) {
      state.scenes.unshift(r.record);
      okCount++;
      report.push({ name: f.name, ok: true, msg: `${r.record.manifest.title}（${r.record.tier === 'A' ? '规范' : '兼容'}）`, warnings: r.warnings });
      persist(); renderAll(); renderEntry();
      captureThumb(r.record);
    } else {
      report.push({ name: f.name, ok: false, msg: r.errors.join('；'), warnings: r.warnings });
    }
  }
  persist(); renderAll(); renderEntry();
  if (okCount) {
    toast(`成功导入 ${okCount} 个场景`);
    switchView('entry');
  }
  showReport(report);
  return okCount;
}

/* ------------------------------------------------------------ */
/* 弹窗：导入报告 / 规范                                         */
/* ------------------------------------------------------------ */
function showReport(report) {
  const body = report.map(r => `
    <div class="rep ${r.ok ? 'ok' : 'err'}">
      <div class="rep-head">${r.ok ? '✓' : '✗'} ${esc(r.name)}</div>
      <div class="rep-msg">${esc(r.msg)}</div>
      ${r.warnings && r.warnings.length ? `<div class="rep-warns">${r.warnings.map(w => '· ' + esc(w)).join('<br>')}</div>` : ''}
    </div>`).join('');
  openModal('导入报告', body + `<div class="modal-tip">提示：把「spec/AI提示词.md」整段发给任意 AI，它生成的 HTML 就能直接拖进来。</div>`);
}

function openModal(title, html) {
  $('#modalTitle').textContent = title;
  $('#modalBody').innerHTML = html;
  $('#modal').hidden = false;
  requestAnimationFrame(() => $('#modal').classList.add('show'));
}
function closeModal() {
  $('#modal').classList.remove('show');
  setTimeout(() => { $('#modal').hidden = true; }, 200);
}

async function showSpecModal() {
  openModal('白膜 HTML 规范 · v1.0', '<div class="modal-loading">加载中…</div>');
  try {
    const [spec, prompt] = await Promise.all([
      fetch('spec/白膜HTML规范.md').then(r => r.text()),
      fetch('spec/AI提示词.md').then(r => r.text()),
    ]);
    $('#modalBody').innerHTML = `
      <div class="spec-actions">
        <button class="op primary" id="spCopy">复制 AI 提示词</button>
        <button class="op" id="spTpl">下载模板 template.html</button>
        <button class="op" id="spEx">下载示例 example.html</button>
        <a class="op" href="https://github.com/Twdhsi-666/whitebox-workbench/blob/main/spec/%E7%99%BD%E8%86%9CHTML%E8%A7%84%E8%8C%83.md" target="_blank">在线查看规范</a>
      </div>
      <pre class="spec-pre">${esc(spec)}</pre>`;
    $('#spCopy').onclick = async () => {
      try { await navigator.clipboard.writeText(prompt); toast('AI 提示词已复制，去发给任意 AI 吧'); }
      catch (e) { download('AI提示词.md', prompt); toast('剪贴板不可用，已下载提示词文件', 'warn'); }
    };
    $('#spTpl').onclick = async () => {
      const t = await fetch('spec/template.html').then(r => r.text());
      download('template.html', t, 'text/html;charset=utf-8');
    };
    $('#spEx').onclick = async () => {
      const t = await fetch('spec/example.html').then(r => r.text());
      download('example.html', t, 'text/html;charset=utf-8');
    };
  } catch (e) {
    $('#modalBody').innerHTML = '<div class="modal-loading">规范文件加载失败（需要通过本地服务器打开工作台）</div>';
  }
}

/* ------------------------------------------------------------ */
/* 事件绑定                                                      */
/* ------------------------------------------------------------ */
function bindUI() {
  /* ---- 入口 ---- */
  $('#enCardImport').onclick = () => $('#fileInput').click();
  $('#enCardNew').onclick = () => openEditor({ env: 'room' });
  $('#enBtnLibrary').onclick = () => switchView('library');
  $('#enBtnSpec').onclick = showSpecModal;

  /* ---- 库视图 ---- */
  $('#libBack').onclick = () => { closeDetail(); switchView('entry'); renderEntry(); };
  $('#btnNewNative').onclick = () => openEditor({ env: 'room' });

  $('#searchInput').addEventListener('input', (e) => { state.search = e.target.value; renderAll(); });
  $('#btnImport').onclick = () => $('#fileInput').click();
  $('#fileInput').addEventListener('change', async (e) => {
    if (e.target.files.length) await handleFiles(e.target.files);
    e.target.value = '';
  });

  $('#btnLoadExample').onclick = async () => {
    try {
      const html = await fetch('spec/example.html').then(r => r.text());
      const file = new File([html], 'example-伴学小盒子.html', { type: 'text/html' });
      await handleFiles([file]);
    } catch (e) { toast('示例加载失败：' + e.message, 'err'); }
  };

  $('#btnSpec').onclick = showSpecModal;

  $('#btnExportProj').onclick = () => {
    if (!state.scenes.length) return toast('还没有场景可导出', 'warn');
    download('白膜工作台项目.json', store.exportProject(state.scenes), 'application/json');
  };
  $('#btnClearAll').onclick = () => {
    const btn = $('#btnClearAll');
    if (btn.dataset.confirm) {
      state.scenes = []; persist(); renderAll(); renderEntry(); closeDetail();
      delete btn.dataset.confirm; btn.textContent = '清空';
      toast('已清空全部场景');
    } else {
      btn.dataset.confirm = '1'; btn.textContent = '确认清空';
      setTimeout(() => { delete btn.dataset.confirm; btn.textContent = '清空'; }, 3000);
    }
  };

  $('#sceneList').addEventListener('click', (e) => {
    const del = e.target.closest('[data-del]');
    if (del) { e.stopPropagation(); removeScene(del.dataset.del); if (state.activeId === del.dataset.del) closeDetail(); return; }
    const item = e.target.closest('.lib-item');
    if (item) openScene(item.dataset.id);
  });
  $('#gridCards').addEventListener('click', (e) => {
    const card = e.target.closest('.card');
    if (card) openScene(card.dataset.id);
  });

  /* ---- 编辑器 ---- */
  $('#edBack').onclick = () => {
    // 脏检查：有未保存改动（物体/机位/涂装）先自动保存，杜绝静默丢失
    if (editor && JSON.stringify(editor.serialize()) !== lastSavedJSON) saveEditor();
    closeEditor();
  };
  $('#edSave').onclick = saveEditor;
  $('#edShot').onclick = () => {
    try {
      const url = editor.captureThumb(1280, 720);
      const a = document.createElement('a');
      a.href = url;
      a.download = (($('#edName').value || '白膜场景').trim() || '白膜场景') + '.jpg';
      a.click();
      toast('已保存截图');
    } catch (e) { toast('截图失败', 'err'); }
  };
  $('#edGrid').onclick = () => {
    editor.grid.visible = !editor.grid.visible;
    $('#edGrid').classList.toggle('on', editor.grid.visible);
  };
  $('#edDel').onclick = () => editor && editor.deleteSelected();
  $('#edDrawerClose').onclick = closeDrawer;
  $('#edAssetSearch').addEventListener('input', (e) => renderAssetGrid(e.target.value.trim()));

  /* ---- 模态框 ---- */
  $('#modalClose').onclick = closeModal;
  $('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });

  /* ---- 键盘 ---- */
  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.key === 'Escape') {
      if (!$('#modal').hidden) closeModal();
      else if (state.view === 'editor') $('#edBack').click();
      else if (!$('#detail').hidden) closeDetail();
    }
    if (e.key === ' ' && player && state.view === 'library') {
      e.preventDefault();
      $('#ctlPlay').click();
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && state.view === 'editor' && editor && editor.selected) {
      e.preventDefault();
      editor.deleteSelected();
    }
  });

  /* ---- 整窗拖拽导入 ---- */
  let dragDepth = 0;
  window.addEventListener('dragenter', (e) => {
    if (![...e.dataTransfer.types].includes('Files')) return;
    dragDepth++; $('#dropMask').hidden = false;
  });
  window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('#dropMask').hidden = true; } });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', async (e) => {
    e.preventDefault();
    dragDepth = 0; $('#dropMask').hidden = true;
    if (e.dataTransfer.files.length) await handleFiles(e.dataTransfer.files);
  });
}

/* ------------------------------------------------------------ */
/* 启动                                                          */
/* ------------------------------------------------------------ */
function init() {
  state.scenes = store.load();
  bindUI();
  initStarfield();
  renderEntry();
  switchView('entry');
  if (state.scenes.length) {
    toast(`已恢复 ${state.scenes.length} 个本地场景`);
  }
  // 调试/自动化测试钩子
  window.__wb = {
    get editor() { return editor; },
    get scenes() { return state.scenes; },
    get view() { return state.view; },
    switchView, openEditor, saveEditor, handleFiles,
  };
}

init();
