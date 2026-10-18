// 工程数据模型：一个工程 = 场景预设 + 人物走位 + 镜头表。存 localStorage，可导出 JSON、可编进 URL 分享。
import { sampleShot } from '../engine/camera.js';
import { ease } from '../engine/easing.js';

export const PROJECT_VERSION = 3;

export function newProject(over = {}) {
  return Object.assign({
    version: PROJECT_VERSION,
    name: '未命名工程',
    preset: 'example_living_room',
    aspect: '16:9',
    fps: 25,
    mode: 'cuts',              // cuts=硬切换 / continuous=一镜到底（相邻镜头之间做混合过渡）
    blend: 0.8,                // 一镜到底时相邻段之间的过渡秒数（竞品实操口径：≥0.8 秒，否则生成时抖、跳切）
    look: { env: true, shadows: true, edges: true, ground: true },
    figures: [],
    shots: [],
    notes: ''
  }, over);
}

export function newShot(from, over = {}) {
  return Object.assign({
    id: 's' + Math.random().toString(36).slice(2, 7),
    n: '镜头',
    move: 'static',
    pos: [3, 1.6, 3],
    look: [0, 1.1, 0],
    mm: 35,
    ease: 'smoothstep',
    dur: 2,
    params: {},
    subject: null,             // 跟随时锁定的 figure id
    keepSide: true,            // 参与越轴检查
    notes: '',
    cue: ''                    // 这一镜头要发生的事（写进提示词包）
  }, over, from ? { pos: from.pos.slice(), look: from.look.slice(), mm: from.mm } : {});
}

export function newFigure(over = {}) {
  return Object.assign({
    id: 'f' + Math.random().toString(36).slice(2, 7),
    name: '人物',
    p: [0, 0, 0],
    facing: 0,
    height: 1.75,
    action: 'stand',
    seatY: null,
    path: [],                  // [[x,z], ...] 地面走位；空 = 不动
    startT: 0,
    endT: 4,
    pathEase: 'linear'
  }, over);
}

// ---- 时间轴 ----

export function timeline(project) {
  let t = 0;
  const rows = project.shots.map((s, i) => {
    const dur = Math.max(0.1, Number(s.dur) || 2);
    const row = { i, id: s.id, n: s.n, t0: t, t1: t + dur, dur };
    t += dur;
    return row;
  });
  return { rows, total: t };
}

export function shotAt(project, t) {
  const rows = timeline(project).rows;
  if (!rows.length) return null;
  for (const r of rows) {
    if (t >= r.t0 && t < r.t1) return { row: r, shot: project.shots[r.i], u: (t - r.t0) / r.dur, localT: t - r.t0 };
  }
  const last = rows[rows.length - 1];
  return t < last.t0
    ? { row: rows[0], shot: project.shots[rows[0].i], u: 0, localT: 0 }
    : { row: last, shot: project.shots[last.i], u: 1, localT: last.dur };
}

// 一镜到底时：段与段之间做 blend 秒的相机混合，避免位置瞬移被生成模型判成抖镜头
export function cameraAt(project, t) {
  const cur = shotAt(project, t);
  if (!cur) return { pos: [3, 1.6, 3], look: [0, 1.1, 0], mm: 35 };
  const subj = subjectAt(project, cur.shot.subject, t);
  let cam = sampleShot(cur.shot, cur.u, t, subj ? { subject: subj } : {});

  if (project.mode === 'continuous' && cur.row.i > 0) {
    const prev = project.shots[cur.row.i - 1];
    const blend = Math.max(0, Number(project.blend) || 0);
    const span = Math.min(cur.row.t0 + blend, cur.row.t1);
    if (t < span && blend > 0) {
      const b = ease('cubicInOut')((t - cur.row.t0) / (span - cur.row.t0));
      const from = sampleShot(prev, 1, cur.row.t0, {});
      cam = {
        pos: lerp3(from.pos, cam.pos, b),
        look: lerp3(from.look, cam.look, b),
        mm: from.mm + (cam.mm - from.mm) * b
      };
    }
  }
  return cam;
}

const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// 走位：把折线按弧长参数化，人物沿路走，朝向跟着切线
export function pathLength(path) {
  let L = 0;
  for (let i = 1; i < path.length; i++) L += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
  return L;
}

export function pathPoint(path, u) {
  if (!path || path.length === 0) return null;
  if (path.length === 1) return [path[0][0], path[0][1]];
  const total = pathLength(path);
  if (total <= 1e-6) return [path[0][0], path[0][1]];
  let want = Math.max(0, Math.min(1, u)) * total, acc = 0;
  for (let i = 1; i < path.length; i++) {
    const seg = Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
    if (acc + seg >= want) {
      const k = seg <= 1e-6 ? 0 : (want - acc) / seg;
      return [path[i - 1][0] + (path[i][0] - path[i - 1][0]) * k, path[i - 1][1] + (path[i][1] - path[i - 1][1]) * k];
    }
    acc += seg;
  }
  return [path[path.length - 1][0], path[path.length - 1][1]];
}

export function pathTangent(path, u) {
  if (!path || path.length < 2) return null;
  const a = pathPoint(path, Math.max(0, u - 0.02)), b = pathPoint(path, Math.min(1, u + 0.02));
  const dx = b[0] - a[0], dz = b[1] - a[1];
  if (Math.hypot(dx, dz) < 1e-4) return null;
  return Math.atan2(dx, dz);       // three 里 +Z 为 0 弧度，绕 Y 轴
}

export function figureAt(project, fig, t) {
  const hasPath = fig.path && fig.path.length > 1;
  if (!hasPath) return { p: fig.p.slice(), facing: fig.facing, action: fig.action, moving: false, u: 0 };
  const dur = Math.max(0.2, (fig.endT || 1) - (fig.startT || 0));
  const raw = (t - (fig.startT || 0)) / dur;
  const u = ease(fig.pathEase || 'linear')(Math.max(0, Math.min(1, raw)));
  const pt = pathPoint(fig.path, u);
  const tan = pathTangent(fig.path, u);
  return {
    p: [pt[0], fig.p[1], pt[1]],
    facing: tan != null ? tan : fig.facing,
    action: raw <= 0 ? 'stand' : (fig.action || 'walk'),
    moving: raw > 0 && raw < 1,
    u
  };
}

export function subjectAt(project, figId, t) {
  if (!figId) return null;
  const f = project.figures.find(x => x.id === figId);
  if (!f) return null;
  const s = figureAt(project, f, t);
  const h = f.height || 1.75;
  return [s.p[0], s.p[1] + h * 0.62, s.p[2]];   // 胸口偏上，符合"锚点=胸口/头部"的口径
}

// 速度提示：轨道长度 ÷ 时长（UP 主口径：关键帧拖远变慢、拖近变快）
export function figureSpeed(project, fig) {
  if (!fig.path || fig.path.length < 2) return 0;
  const dur = Math.max(0.2, (fig.endT || 1) - (fig.startT || 0));
  return pathLength(fig.path) / dur;
}

export const WALK_SPEED = 1.25, RUN_SPEED = 3.4;

// ---- 存储 ----

const KEY = 'coconut.workbench.project';

export function saveLocal(project) {
  try { localStorage.setItem(KEY, JSON.stringify(project)); return true; } catch (e) { return false; }
}
export function loadLocal() {
  try { const s = localStorage.getItem(KEY); return s ? JSON.parse(s) : null; } catch (e) { return null; }
}
export function clearLocal() { try { localStorage.removeItem(KEY); } catch (e) {} }

export function toHash(project) {
  const json = JSON.stringify(project);
  const b = new TextEncoder().encode(json);
  let bin = '';
  for (const x of b) bin += String.fromCharCode(x);
  return '#' + btoa(bin).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

export function fromHash(hash) {
  if (!hash || !hash.startsWith('#')) return null;
  try {
    let s = hash.slice(1).replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    const bin = atob(s);
    const b = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
    return JSON.parse(new TextDecoder().decode(b));
  } catch (e) { return null; }
}

export function download(name, text, mime) {
  const blob = new Blob([text], { type: mime || 'application/octet-stream' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
