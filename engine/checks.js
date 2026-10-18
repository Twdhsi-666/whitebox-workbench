// 逻辑体检：预设结构 + 机位 + 镜头连续性。纯数学，Node（tools/validate.mjs）和工作台界面共用这一份。
import { V, basis, sampleShot, fovFromMM } from './camera.js';
import * as THREE from '../vendor/three.module.js';

const { sub, add, mul, len, nrm, cross } = V;
const dot_ = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const push = (out, lvl, code, msg, who) => out.push({ lvl, code, msg, who });

const SOLID_KINDS = new Set(['wall', 'prop', 'subject']);
// 机位能不能被挡住：人也要算（穿模检查里人不算，否则每个坐下的演员都会和自己的椅子报冲突）
const BLOCKERS = new Set(['wall', 'prop', 'subject', 'person']);
const isBlocker = it => BLOCKERS.has(it.kind) && it.solid && it.def && it.def.m !== 'glass' && it.def.m !== 'mark';

function aabbInter(a, b) {
  const ix = Math.min(a.max.x, b.max.x) - Math.max(a.min.x, b.min.x);
  const iy = Math.min(a.max.y, b.max.y) - Math.max(a.min.y, b.min.y);
  const iz = Math.min(a.max.z, b.max.z) - Math.max(a.min.z, b.min.z);
  if (ix <= 0 || iy <= 0 || iz <= 0) return 0;
  return ix * iy * iz;
}
const vol = b => Math.max(0, b.max.x - b.min.x) * Math.max(0, b.max.y - b.min.y) * Math.max(0, b.max.z - b.min.z);

// 1) 预设结构
export function checkSchema(preset, out = []) {
  if (!preset || !preset.objects || !preset.objects.length) push(out, 'err', 'no_objects', '预设里没有 objects');
  const names = new Set();
  const walk = list => {
    for (const o of list || []) {
      if (o.n) { if (names.has(o.n)) push(out, 'err', 'dup_name', `重名："${o.n}"`, o.n); names.add(o.n); }
      if (o.t === 'group') { if (!o.children || !o.children.length) push(out, 'warn', 'empty_group', `空组 "${o.n || '?'}"`, o.n); walk(o.children); }
      else if (o.t === 'figure') { if (o.action && !KNOWN_ACTIONS.has(o.action)) push(out, 'warn', 'bad_action', `"${o.n || '人'}" 的动作 ${o.action} 不存在`, o.n); }
      else if (!['box', 'cyl', 'sphere', 'plane', 'mark'].includes(o.t)) push(out, 'err', 'bad_prim', `图元 "${o.t}" 不在允许列表`, o.n);
      else if (!o.s) push(out, 'err', 'no_size', `"${o.n || o.t}" 少了 s（尺寸）`, o.n);
      else if (o.s.some(v => typeof v !== 'number' || Number.isNaN(v))) push(out, 'err', 'bad_size', `"${o.n || o.t}" 尺寸里有非数字`, o.n);
      if (o.p && o.p.length !== 3) push(out, 'err', 'bad_pos', `"${o.n || o.t}" 的 p 必须是 [x,y,z]`, o.n);
    }
  };
  walk(preset.objects);
  const n = names.size;
  const total = countAll(preset.objects);
  if (total < 12) push(out, 'warn', 'too_few', `物体只有 ${total} 个，画面会空（建议 12~60）`);
  if (total > 220) push(out, 'warn', 'too_many', `物体 ${total} 个，超过 220 个后体检和逐帧渲染会明显变慢`);
  const suns = (preset.lights || []).filter(l => l.t === 'sun');
  if (!suns.length) push(out, 'err', 'no_sun', '没有 sun 主光，越轴/光源一致性检查没法做');
  if ((preset.cameras || []).length < 4) push(out, 'warn', 'few_cams', `推荐机位只有 ${(preset.cameras || []).length} 个，至少给 4 个`);
  return out;
}

const KNOWN_ACTIONS = new Set(['stand', 'walk', 'run', 'turn', 'sit', 'standup', 'reach', 'pass', 'cough', 'nod', 'shake', 'point', 'bend', 'look', 'wave']);
function countAll(list) {
  let n = 0;
  for (const o of list || []) { n++; if (o.t === 'group') n += countAll(o.children); }
  return n;
}

// 2) 几何体检：贴合关系 + 悬空 + 越界 + 穿模
// 白膜里的正常做法不能当 bug 报：贴在墙上的电视、放在茶几上的药盒、同一件家具的部件互相插一点，都算合规。
const GAP = 0.04;
const axisOverlap = (a, b, k) => Math.min(a.max[k], b.max[k]) - Math.max(a.min[k], b.min[k]);
const axisGap = (a, b, k) => Math.max(a.min[k] - b.max[k], b.min[k] - a.max[k]);

function touches(a, b) {
  const ov = ['x', 'y', 'z'].map(k => axisOverlap(a, b, k));
  const nPos = ov.filter(v => v > 1e-6).length;
  if (nPos === 3) return true;                       // 三体相交，也算贴合
  if (nPos !== 2) return false;
  const gapAxis = ov.findIndex(v => v <= 1e-6);
  return axisGap(a, b, ['x', 'y', 'z'][gapAxis]) <= GAP;
}

export function checkGeometry(items, preset, out = []) {
  const g = preset.ground ? { x: preset.ground.size[0] / 2, z: preset.ground.size[1] / 2 } : null;
  const checkable = items.filter(i => i.kind !== 'floor' && i.kind !== 'mark');

  for (const it of checkable) {
    const bg = it.scope === 'background';   // 远景天际线层：本来就在场地外，不查越界
    const b = it.box;
    if (g && !bg) {
      const c = [ (b.min.x + b.max.x) / 2, 0, (b.min.z + b.max.z) / 2 ];
      if (Math.abs(c[0]) > g.x + 0.1 || Math.abs(c[2]) > g.z + 0.1)
        push(out, 'warn', 'out_of_ground', `"${it.name}" 的中心掉到地面范围外（地面 ${preset.ground.size.join('×')} 米）`, it.name);
    }
    if (b.max.y < -0.02) push(out, 'err', 'under_floor', `"${it.name}" 整块沉到地面以下（顶面 y=${b.max.y.toFixed(2)}）`, it.name);

    const bottom = b.min.y;
    if (bottom > 0.05) {
      const attached = items.some(o => o !== it && o.kind !== 'mark' && touches(b, o.box));
      const hang = it.hang;
      if (!attached && !hang && !bg)
        push(out, 'warn', 'floating', `"${it.name}" 悬空：底面离地 ${bottom.toFixed(2)} 米，旁边也没有任何物体贴着它`, it.name);
    } else if (bottom < -0.05 && !bg) {
      push(out, 'warn', 'sunk', `"${it.name}" 底部插进地里 ${(-bottom).toFixed(2)} 米`, it.name);
    }
  }

  const solids = items.filter(i => SOLID_KINDS.has(i.kind) && i.solid && i.def && i.def.m !== 'glass' && i.def.m !== 'mark');
  for (let i = 0; i < solids.length; i++) {
    for (let j = i + 1; j < solids.length; j++) {
      const a = solids[i], b = solids[j];
      if (a.gid && a.gid === b.gid) continue;      // 同一件家具的部件，穿插是建模手法
      const ov = aabbInter(a.box, b.box);
      if (ov <= 0) continue;
      const r = Math.max(ov / Math.max(1e-6, vol(a.box)), ov / Math.max(1e-6, vol(b.box)));
      if (r > 0.25) push(out, 'warn', 'intersect', `"${a.name}" 与 "${b.name}" 穿模，小的一方有 ${(r * 100).toFixed(0)}% 埋进对方`, `${a.name}/${b.name}`);
    }
  }
  return out;
}

// 3) 机位体检：穿模、地底、空镜头
export function checkCameras(preset, items, sceneRoot, out = []) {
  // 射线距离按场景尺寸推，不能硬顶 30 米：天台/街景拍 45 米外的楼群会被误判成空镜头
  const reach = Math.max(60, ...(preset.ground ? preset.ground.size : [40, 40]).map(v => v * 4));
  for (const cam of preset.cameras || []) {
    const p = cam.pos, look = cam.look;
    if (!p || !look) { push(out, 'err', 'bad_cam', `机位 "${cam.n}" 缺 pos 或 look`, cam.n); continue; }
    if (p[1] < 0.2) push(out, 'warn', 'cam_low', `机位 "${cam.n}" 高度只有 ${p[1].toFixed(2)} 米，除非有意低角度`, cam.n);
    if (p[1] > 6) push(out, 'warn', 'cam_high', `机位 "${cam.n}" 高度 ${p[1].toFixed(2)} 米，室内会顶到天花板`, cam.n);
    const inside = items.find(it => isBlocker(it) && it.box.containsPoint(new THREE.Vector3(...p)));
    if (inside) push(out, 'err', 'cam_in_solid', `机位 "${cam.n}" 埋在 "${inside.name}" 里面，拍到的是黑屏`, cam.n);
    const dist = len(sub(look, p));
    if (dist < 0.4) push(out, 'warn', 'cam_too_close', `机位 "${cam.n}" 离注视点只有 ${dist.toFixed(2)} 米`, cam.n);
    if (sceneRoot && !hitsSomething(p, look, sceneRoot, cam.reach || reach)) {
      push(out, 'warn', 'empty_shot', `机位 "${cam.n}" 看出去是空的（正对 30 米内没东西）`, cam.n);
    }
  }
  return out;
}

export function hitsAny(ray, meshes) {
  const rc = new THREE.Raycaster();
  rc.ray = ray;
  return rc.intersectObjects(meshes, false).length > 0;
}

export function hitsAnywhere(origin, target, root, maxDist) {
  const dir = nrm(sub(target, origin));
  const ray = new THREE.Raycaster(new THREE.Vector3(...origin), new THREE.Vector3(...dir), 0.05, maxDist || 30);
  const meshes = [];
  root.traverse(o => { if (o.isMesh && o.visible && o.material && o.material.visible !== false) meshes.push(o); });
  return ray.intersectObjects(meshes, false).length > 0;
}

function hitsSomething(origin, target, root, reach) {
  const d = Math.min(reach || 60, len(sub(target, origin)) + 6);
  const fwd = nrm(sub(target, origin));
  if (hitsAnywhere(origin, add(origin, mul(fwd, d)), root, d)) return true;
  // 视野四角也扫一下：中心空但边角有东西不算空镜头
  const right = nrm(cross(fwd, [0, 1, 0]));
  const up = cross(right, fwd);
  const spread = 0.35;
  for (const [sx, sy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    const dir = nrm(add(add(mul(fwd, 1), mul(right, sx * spread)), mul(up, sy * spread)));
    if (hitsAnywhere(origin, add(origin, mul(dir, d)), root, d)) return true;
  }
  return false;
}

// 4) 镜头连续性：越轴（主体左右翻转）、机位过近、焦段跳变、光源打脸
export function checkContinuity(shots, preset, out = []) {
  const subject = shots.find(s => s.subject)?.subject || preset.subject || null;
  if (!subject) return out;
  const S = Array.isArray(subject) ? subject : (subject.pos || [0, 1, 0]);

  for (let i = 1; i < shots.length; i++) {
    const a = shots[i - 1], b = shots[i];
    const ca = sampleShot(a, 0.5, i), cb = sampleShot(b, 0.5, i + 1);
    const ba = basis(ca), bb = basis(cb);
    const sa = dot_(sub(S, ca.pos), ba.right), sb = dot_(sub(S, cb.pos), bb.right);
    if (a.keepSide && b.keepSide && Math.sign(sa) !== Math.sign(sb) && Math.abs(sa) > 0.25 && Math.abs(sb) > 0.25) {
      push(out, 'err', 'cross_line',
        `镜头 ${a.n || i} → ${b.n || i + 1} 越轴：主体从画面${sa > 0 ? '右' : '左'}边跳到了${sb > 0 ? '右' : '左'}边`, `${a.n}/${b.n}`);
    }
    const d = len(sub(ca.pos, cb.pos));
    if (d < 0.5 && Math.abs((a.mm || 35) - (b.mm || 35)) < 6) {
      push(out, 'warn', 'similar_setup', `镜头 ${i} 和 ${i + 1} 机位只差 ${d.toFixed(2)} 米、焦段也接近，剪起来像没换机位`, `${a.n}/${b.n}`);
    }
    if (a.dir && b.dir) {
      const ang = Math.acos(Math.max(-1, Math.min(1, dot_(nrm(a.dir), nrm(b.dir)))) * 180 / Math.PI);
      if (ang > 55) push(out, 'warn', 'sun_flip', `镜头 ${i} → ${i + 1} 主光方向转了 ${ang.toFixed(0)}°，脸的明暗会跳`, `${a.n}/${b.n}`);
    }
  }
  // 走位方向在画面里翻转 = 最典型的越轴
  const mv = shots.filter(s => s.move_from && s.move_to);
  for (let i = 1; i < mv.length; i++) {
    const a = mv[i - 1], b = mv[i];
    const ca = sampleShot(a, 0.5, i), cb = sampleShot(b, 0.5, i + 1);
    const va = nrm(sub(a.move_to, a.move_from)), vb = nrm(sub(b.move_to, b.move_from));
    const sa = dot_(va, basis(ca).right), sb = dot_(vb, basis(cb).right);
    if (Math.abs(sa) > 0.25 && Math.abs(sb) > 0.25 && Math.sign(sa) !== Math.sign(sb)) {
      push(out, 'err', 'cross_line', `走位越轴：镜头 ${i} 里人往${sa > 0 ? '右' : '左'}走，镜头 ${i + 1} 变成往${sb > 0 ? '右' : '左'}走`, `${a.n}/${b.n}`);
    }
  }
  return out;
}

// 5) 镜头相机体检：对工程里的镜头表逐个采样（起点/中点/终点）
export function checkShotCameras(preset, items, sceneRoot, shots, out = []) {
  if (!shots || !shots.length) return out;
  const reach = Math.max(60, ...(preset.ground ? preset.ground.size : [40, 40]).map(v => v * 4));
  let t = 0;
  shots.forEach((s, i) => {
    const dur = Math.max(0.1, Number(s.dur) || 2);
    const t0 = t, t1 = t + dur; t = t1;
    const label = s.n || `镜头${i + 1}`;
    for (const u of [0, 0.5, 1]) {
      const c = sampleShot(s, u, t0 + dur * u, {});
      const inside = items.find(it => isBlocker(it) && it.box.containsPoint(new THREE.Vector3(...c.pos)));
      if (inside) { push(out, 'err', 'cam_in_solid', `${label}（${(u * 100).toFixed(0)}%处）机位埋在 "${inside.name}" 里，拍到的是黑屏`, label); break; }
      if (c.pos[1] < 0.15) push(out, 'warn', 'cam_low', `${label}（${(u * 100).toFixed(0)}%处）机位高度 ${c.pos[1].toFixed(2)} 米，贴地了`, label);
    }
    const mid = sampleShot(s, 0.5, t0 + dur / 2, {});
    if (sceneRoot && !hitsSomething(mid.pos, mid.look, sceneRoot, s.reach || reach))
      push(out, 'warn', 'empty_shot', `${label} 看出去是空的（${reach} 米内正前方和四角都没东西）`, label);
    if (dur < 0.5) push(out, 'warn', 'short_shot', `${label} 只有 ${dur.toFixed(2)} 秒，生成模型一般吃不住这么短的段`, label);
  });
  return out;
}

export function runAll(preset, items, sceneRoot, shots) {
  const out = [];
  checkSchema(preset, out);
  if (items) checkGeometry(items, preset, out);
  if (sceneRoot) checkCameras(preset, items || [], sceneRoot, out);
  if (shots && items) checkShotCameras(preset, items, sceneRoot, shots, out);
  if (shots) checkContinuity(shots, preset, out);
  return out;
}

export { fovFromMM };
