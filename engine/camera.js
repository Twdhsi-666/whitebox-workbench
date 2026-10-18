// 相机模型：全画幅 36mm 感光宽度换算焦段↔FOV，运镜预设是纯数学（Node 和浏览器都能跑，导出可复现）。
import { ease } from './easing.js';

export const FILM_GAUGE = 36;

export const LENSES = [
  { mm: 14, label: '14mm 超广', note: '畸变大，空间压迫' },
  { mm: 21, label: '21mm 广角', note: '环境交代' },
  { mm: 24, label: '24mm 广角', note: '室内常用' },
  { mm: 28, label: '28mm 人文', note: '纪实感' },
  { mm: 35, label: '35mm 街拍', note: '最接近人眼注意力' },
  { mm: 40, label: '40mm', note: '中性' },
  { mm: 50, label: '50mm 标准', note: '对话正反打' },
  { mm: 65, label: '65mm 中长', note: '人物特写' },
  { mm: 85, label: '85mm 长焦', note: '压缩纵深、背景糊' },
  { mm: 100, label: '100mm', note: '产品特写' },
  { mm: 135, label: '135mm', note: '极压缩，街道拉长' }
];

export const RATIOS = [
  { id: '16:9', label: '16:9 横屏', w: 1920, h: 1080 },
  { id: '9:16', label: '9:16 竖屏', w: 1080, h: 1920 },
  { id: '4:3', label: '4:3 学院', w: 1440, h: 1080 },
  { id: '1:1', label: '1:1 方形', w: 1080, h: 1080 },
  { id: '4:5', label: '4:5 信息流', w: 864, h: 1080 },
  { id: '2.39:1', label: '2.39:1 宽银幕', w: 2048, h: 858 },
  { id: '1.85:1', label: '1.85:1 宽银幕', w: 1920, h: 1038 }
];

export const ratioWH = id => { const r = RATIOS.find(x => x.id === id); return r ? [r.w, r.h] : (id || '16:9').split(':').map(Number); };
export const aspectOf = id => { const [w, h] = ratioWH(id); return w / h; };

export function fovFromMM(mm, aspect) {
  const halfLong = FILM_GAUGE / 2;
  return aspect >= 1 ? 2 * Math.atan(halfLong / (mm * aspect)) * 180 / Math.PI
                     : 2 * Math.atan(halfLong / mm) * 180 / Math.PI;
}
export function mmFromFov(fovDeg, aspect) {
  const halfLong = FILM_GAUGE / 2;
  const t = Math.tan((fovDeg * Math.PI / 180) / 2);
  return aspect >= 1 ? halfLong / (t * aspect) : halfLong / t;
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const len = a => Math.hypot(a[0], a[1], a[2]);
const nrm = a => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export const V = { sub, add, mul, len, nrm, cross, lerp, clamp };

export function basis(cam) {
  const fwd = nrm(sub(cam.look, cam.pos));
  const right = nrm(cross(fwd, [0, 1, 0]));
  const up = cross(right, fwd);
  return { fwd, right, up };
}

// 每个运镜：apply(u, c) → 新的 {pos, look, mm}；c 里有 cam0 / cam1 / dist / target / t / p(参数) / ease
const M = (id, label, cn, params, apply) => ({ id, label, cn, params, apply });

export const MOVES = [
  M('static', '固定机位', 'Lock-off', [],
    (u, c) => ({ ...c.cam0 })),
  M('push_in', '推进', 'Dolly in / Push in',
    [{ k: 'dist', l: '推进距离(米)', d: 1.6 }, { k: 'to_mm', l: '终点焦段', d: 50 }],
    (u, c) => {
      const e = c.ease(u), d = c.p.dist ?? 1.6;
      const f = nrm(sub(c.cam0.look, c.cam0.pos));
      return { pos: add(c.cam0.pos, mul(f, d * e)), look: c.cam0.look, mm: (c.cam0.mm ?? 35) + ((c.p.to_mm ?? (c.cam0.mm ?? 35)) - (c.cam0.mm ?? 35)) * e };
    }),
  M('pull_out', '拉出', 'Dolly out / Pull back',
    [{ k: 'dist', l: '拉出距离(米)', d: 1.6 }, { k: 'to_mm', l: '终点焦段', d: 28 }],
    (u, c) => {
      const e = c.ease(u), d = c.p.dist ?? 1.6;
      const f = nrm(sub(c.cam0.look, c.cam0.pos));
      return { pos: sub(c.cam0.pos, mul(f, d * e)), look: c.cam0.look, mm: (c.cam0.mm ?? 35) + ((c.p.to_mm ?? (c.cam0.mm ?? 35)) - (c.cam0.mm ?? 35)) * e };
    }),
  M('truck_l', '横移（左）', 'Truck left', [{ k: 'dist', l: '移动距离', d: 1.2 }],
    (u, c) => { const e = c.ease(u); const r = basis(c.cam0).right; return { ...c.cam0, pos: sub(c.cam0.pos, mul(r, (c.p.dist ?? 1.2) * e)), look: sub(c.cam0.look, mul(r, (c.p.dist ?? 1.2) * e)) }; }),
  M('truck_r', '横移（右）', 'Truck right', [{ k: 'dist', l: '移动距离', d: 1.2 }],
    (u, c) => { const e = c.ease(u); const r = basis(c.cam0).right; return { ...c.cam0, pos: add(c.cam0.pos, mul(r, (c.p.dist ?? 1.2) * e)), look: add(c.cam0.look, mul(r, (c.p.dist ?? 1.2) * e)) }; }),
  M('pedestal_u', '升降（上）', 'Pedestal up / Boom up', [{ k: 'dist', l: '升降距离', d: 1.2 }],
    (u, c) => { const e = c.ease(u), d = c.p.dist ?? 1.2; return { pos: add(c.cam0.pos, [0, d * e, 0]), look: add(c.cam0.look, [0, d * e * 0.8, 0]), mm: c.cam0.mm }; }),
  M('crane_down', '俯冲（下摇到位）', 'Crane down', [{ k: 'drop', l: '下降高度', d: 1.8 }],
    (u, c) => { const e = c.ease(u); return { pos: lerp(add(c.cam0.pos, [0, c.p.drop ?? 1.8, 0]), c.cam0.pos, e), look: c.cam0.look, mm: (c.cam0.mm ?? 35) - 6 * (1 - e) }; }),
  M('orbit_l', '环绕（逆时针）', 'Arc / Orbit left',
    [{ k: 'deg', l: '环绕角度', d: 60 }],
    (u, c) => {
      const e = c.ease(u), a = (c.p.deg ?? 60) * Math.PI / 180 * e;
      const rel = sub(c.cam0.pos, c.cam0.look);
      const [x, y, z] = rel;
      const ca = Math.cos(a), sa = Math.sin(a);
      return { pos: add([x * ca - z * sa, y, x * sa + z * ca], c.cam0.look), look: c.cam0.look, mm: c.cam0.mm };
    }),
  M('orbit_r', '环绕（顺时针）', 'Arc / Orbit right',
    [{ k: 'deg', l: '环绕角度', d: 60 }],
    (u, c) => MOVES.find(m => m.id === 'orbit_l').apply(u, { ...c, p: { ...c.p, deg: -(c.p.deg ?? 60) } })),
  M('spin_360', '一镜到底 360° 环绕', 'Full 360 orbit', [{ k: 'h', l: '保持高度', d: 0 }],
    (u, c) => {
      const a = u * Math.PI * 2;
      const rel = sub(c.cam0.pos, c.cam0.look);
      const [x, y, z] = rel;
      const ca = Math.cos(a), sa = Math.sin(a);
      return { pos: add([x * ca - z * sa, y + (c.p.h ?? 0) * Math.sin(u * Math.PI), x * sa + z * ca], c.cam0.look), look: c.cam0.look, mm: c.cam0.mm };
    }),
  M('pan_l', '摇镜头（左）', 'Pan left', [{ k: 'deg', l: '摇过角度', d: 35 }],
    (u, c) => {
      const e = c.ease(u), a = -(c.p.deg ?? 35) * Math.PI / 180 * e;
      const rel = sub(c.cam0.look, c.cam0.pos);
      const [x, y, z] = rel;
      const ca = Math.cos(a), sa = Math.sin(a);
      return { pos: c.cam0.pos, look: add(c.cam0.pos, [x * ca - z * sa, y, x * sa + z * ca]), mm: c.cam0.mm };
    }),
  M('pan_r', '摇镜头（右）', 'Pan right', [{ k: 'deg', l: '摇过角度', d: 35 }],
    (u, c) => MOVES.find(m => m.id === 'pan_l').apply(u, { ...c, p: { ...c.p, deg: -(c.p.deg ?? 35) } })),
  M('tilt_u', '上摇', 'Tilt up', [{ k: 'deg', l: '摇过角度', d: 25 }],
    (u, c) => {
      const e = c.ease(u), a = (c.p.deg ?? 25) * Math.PI / 180 * e;
      const rel = sub(c.cam0.look, c.cam0.pos);
      const b = basis(c.cam0);
      const horiz = len([rel[0], 0, rel[2]]);
      const vert = rel[1];
      const nh = horiz * Math.cos(a) - vert * Math.sin(a);
      const nv = horiz * Math.sin(a) + vert * Math.cos(a);
      const flat = nrm([rel[0], 0, rel[2]]);
      return { pos: c.cam0.pos, look: add(c.cam0.pos, [flat[0] * nh, nv, flat[2] * nh]), mm: c.cam0.mm };
    }),
  M('dolly_zoom', '滑动变焦（背景变形）', 'Dolly zoom / Vertigo',
    [{ k: 'dist', l: '推进距离', d: 2.2 }, { k: 'to_mm', l: '终点焦段', d: 85 }],
    (u, c) => {
      const e = c.ease(u), f = nrm(sub(c.cam0.look, c.cam0.pos));
      const d0 = len(sub(c.cam0.look, c.cam0.pos));
      const moved = mul(f, (c.p.dist ?? 2.2) * e);
      const mm = (c.cam0.mm ?? 35) + ((c.p.to_mm ?? 85) - (c.cam0.mm ?? 35)) * e;
      const keep = d0 * (mm / (c.cam0.mm ?? 35)) / d0;
      return { pos: add(c.cam0.pos, moved), look: c.cam0.look, mm };
    }),
  M('whip_in', '甩镜推进', 'Whip in', [{ k: 'dist', l: '推进距离', d: 2.4 }],
    (u, c) => {
      const e = ease('expoOut')(u), f = nrm(sub(c.cam0.look, c.cam0.pos));
      return { pos: add(c.cam0.pos, mul(f, (c.p.dist ?? 2.4) * e)), look: c.cam0.look, mm: (c.cam0.mm ?? 35) + 10 * e };
    }),
  M('follow', '跟随（保持主体在画面同侧）', 'Follow / Tracking',
    [{ k: 'behind', l: '落后距离(米)', d: 2.4 }, { k: 'height', l: '机位高度', d: 1.5 }],
    (u, c) => {
      const s = c.subject || c.cam0.look;
      const dir = nrm(sub(c.subjectPathEnd || s, c.subjectPathStart || s));
      const h = c.p.height ?? 1.5, bk = c.p.behind ?? 2.4;
      const pos = sub(add(s, [0, h, 0]), mul(dir, bk));
      return { pos, look: add(s, [0, Math.max(0, h - 0.35), 0]), mm: c.cam0.mm ?? 35 };
    }),
  M('handheld', '手持跟拍', 'Handheld / Shoulder mount',
    [{ k: 'amp', l: '抖动幅度', d: 0.035 }, { k: 'freq', l: '抖动频率', d: 1.7 }],
    (u, c) => {
      const a = c.p.amp ?? 0.035, f = c.p.freq ?? 1.7, t = c.t ?? 0, sd = c.seed ?? 1;
      const b = basis(c.cam0);
      const dx = Math.sin(t * f + sd) * a + Math.sin(t * f * 2.7 + sd * 2) * a * 0.4;
      const dy = Math.sin(t * f * 1.3 + sd * 3) * a * 0.8;
      const dz = Math.sin(t * f * 0.9 + sd * 5) * a * 0.5;
      return { pos: add(add(c.cam0.pos, mul(b.right, dx)), [0, dy, 0]), look: add(add(c.cam0.look, mul(b.right, dx * 0.6)), mul(b.fwd, dz)), mm: c.cam0.mm ?? 35 };
    }),
  M('to_cam2', 'A→B 移动（自定义落点）', 'Move from A to B', [],
    (u, c) => {
      const e = c.ease(u), b = c.cam1 || c.cam0;
      return { pos: lerp(c.cam0.pos, b.pos, e), look: lerp(c.cam0.look, b.look, e), mm: lerp([c.cam0.mm ?? 35], [b.mm ?? 35], e)[0] };
    }),
  M('fade_cut', '固定（黑场起）', 'Static from black', [],
    (u, c) => ({ ...c.cam0 }))
];

export const MOVE_LIST = MOVES.map(m => ({ id: m.id, label: m.label, en: m.cn, params: m.params }));

export function sampleShot(shot, u, tSec, extra = {}) {
  const mv = MOVES.find(m => m.id === (shot.move || 'static')) || MOVES[0];
  const c = {
    cam0: { pos: shot.pos, look: shot.look, mm: shot.mm ?? 35 },
    cam1: shot.cam1 ? { pos: shot.cam1.pos, look: shot.cam1.look, mm: shot.cam1.mm } : null,
    p: shot.params || {}, ease: ease(shot.ease || 'smoothstep'), t: tSec, seed: shot.seed || 1,
    subject: extra.subject, subjectPathStart: extra.subjectPathStart, subjectPathEnd: extra.subjectPathEnd
  };
  return mv.apply(clamp(u, 0, 1), c);
}
