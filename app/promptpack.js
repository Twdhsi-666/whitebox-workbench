// 提示词包：把白膜里的"空间事实"翻译成能直接粘进即梦/豆包的文字。
// 竞品实操口径：提示词里不要再写运镜（推进/环绕/跟拍都别写），运镜交给白膜视频；这里只写主体、动作、场景、光线、风格。
import * as THREE from '../vendor/three.module.js';
import { MOVES, aspectOf, fovFromMM, V } from '../engine/camera.js';
import { cameraAt, timeline, figureAt, pathLength } from './state.js';

const { sub, dot_, rightOf } = helpers();

export function visibleItems(vp, camSpec, limit = 12) {
  if (!vp.built) return [];
  const a = aspectOf(vp.aspect);
  const cam = new THREE.PerspectiveCamera(fovFromMM(camSpec.mm, a), a, 0.1, 400);
  cam.position.set(...camSpec.pos);
  cam.lookAt(...camSpec.look);
  cam.updateMatrixWorld(true);
  const fr = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
  const out = [];
  for (const it of vp.built.items) {
    if (it.kind === 'floor' || it.name.startsWith('__')) continue;
    if (it.hiddenByUser) continue;
    if (fr.intersectsBox(it.box)) out.push(it);
    if (out.length >= limit) break;
  }
  return out;
}

export function subjectSide(camSpec, point) {
  const fwd = sub(camSpec.look, camSpec.pos);
  const r = rightOf(fwd);
  const v = sub(point, camSpec.pos);
  const s = dot_(r, v);
  return s > 0.25 ? '画面右侧' : s < -0.25 ? '画面左侧' : '画面中央';
}

export function buildPack({ project, preset, vp }) {
  const rows = timeline(project);
  const mv = id => (MOVES.find(m => m.id === id) || { label: id });
  const lines = [];
  const push = s => lines.push(s);

  push(`# 椰子工作台 · 白膜提示词包`);
  push(``);
  push(`工程：${project.name}    场景：${preset ? preset.name : project.preset}`);
  push(`画幅 ${project.aspect}    ${project.fps}fps    总时长 ${rows.total.toFixed(2)}s    ${project.shots.length} 个镜头`);
  push(`镜头衔接：${project.mode === 'continuous' ? `一镜到底，段间混合 ${project.blend}s` : '硬切换（每个镜头单独生成再剪）'}`);
  push(``);
  push(`## 用法（这四条是别人踩出来的，别改）`);
  push(`1. 白膜视频当**运镜与走位参考**上传，提示词里不要再写"推进/环绕/跟拍/拉出"这类词，写了会和参考冲突。`);
  push(`2. 角色长相用角色图、场景质感用场景图，白膜只负责空间关系。`);
  push(`3. 表情、具体动作细节、画面元素仍然用文字补（白膜控不住这些）。`);
  push(`4. 一镜到底分段时相邻段之间留 ≥0.8 秒过渡，否则生成时抖、跳切。`);
  push(``);
  push(`## 逐镜头`);

  project.shots.forEach((s, i) => {
    const r = rows.rows[i];
    const camStart = cameraAt(project, r.t0 + 0.001);
    const camMid = cameraAt(project, r.t0 + r.dur / 2);
    const camEnd = cameraAt(project, Math.max(r.t0, r.t1 - 0.001));
    const fig = s.subject ? project.figures.find(f => f.id === s.subject) : null;
    const figPt = fig ? [figureAt(project, fig, r.t0 + r.dur / 2).p[0], (fig.height || 1.75) * 0.62, figureAt(project, fig, r.t0 + r.dur / 2).p[2]] : null;
    const vis = vp ? visibleItems(vp, camMid) : [];
    const dist = V.len(sub(camMid.look, camMid.pos));

    push(``);
    push(`### 镜头 ${i + 1}｜${s.n}　${r.t0.toFixed(2)}–${r.t1.toFixed(2)}s（${r.dur}s）`);
    push(`- 运镜（只给白膜用，**不要写进提示词**）：${mv(s.move).label}${Object.entries(s.params || {}).map(([k, v]) => ` ${k}=${v}`).join('，')}`);
    push(`- 焦段 ${camMid.mm.toFixed(0)}mm（垂直 FOV ${fovFromMM(camMid.mm, aspectOf(project.aspect)).toFixed(1)}°），机位到主体约 ${dist.toFixed(2)} 米`);
    push(`- 机位走向：(${camStart.pos.map(n2).join(', ')}) → (${camEnd.pos.map(n2).join(', ')})，全程盯 (${camMid.look.map(n2).join(', ')})`);
    if (figPt) push(`- 主体「${fig.name}」在${subjectSide(camMid, figPt)}，${fig.action || 'stand'}，走位 ${pathLength(fig.path || []).toFixed(2)} 米`);
    if (s.cue) push(`- 这一镜头要发生：${s.cue}`);
    push(`- 白膜里镜头里能看到：${vis.length ? vis.map(v => v.name).join('、') : '（体检说这里可能是空的）'}`);
    push(`- 可以直接抄的提示词：`);
    push(`  > ${suggestPrompt(s, vis, fig, preset, camMid, project)}`);
    push(`- 配套素材：白膜视频 ${r.t0.toFixed(2)}–${r.t1.toFixed(2)}s 这段 + 首帧图 镜头${i + 1}_f0.png`);
  });

  push(``);
  push(`## 出片前的硬阻断体检`);
  const errs = window.__lastFindings ? window.__lastFindings.filter(f => f.lvl === 'err') : [];
  push(errs.length ? errs.map(e => `- ✕ ${e.msg}`).join('\n') : `- ✓ 没有阻断项（以工作台体检面板为准）`);
  push(``);
  push(`## 光源方向（保持一致，否则脸的明暗会跳）`);
  if (preset && preset.lights) {
    const sun = preset.lights.find(l => l.t === 'sun');
    if (sun) push(`- 主光来自 (${(sun.dir || []).map(n2).join(', ')})，强度 ${sun.intensity}`);
  }
  return lines.join('\n');
}

function suggestPrompt(s, vis, fig, preset, cam, project) {
  const who = fig ? `${fig.name}` : '主体';
  const act = fig ? ({ walk: '走动', run: '跑动', sit: '坐着', stand: '站着', cough: '咳嗽', pass: '递东西', point: '指向', bend: '弯腰' }[fig.action] || fig.action) : null;
  const things = vis.slice(0, 5).map(v => v.name.replace(/_.*/, '')).join('、');
  const scene = preset ? preset.name : '';
  const mm = cam.mm >= 65 ? '长焦压缩、背景贴近' : cam.mm <= 28 ? '广角、空间纵深大' : '标准镜头、透视自然';
  const bits = [`${scene}内景`, `${who}${act ? '正' + act : ''}`, things ? `画面里有${things}` : '', `${mm}`, `真实光影、动作连贯、无字幕无水印`];
  return bits.filter(Boolean).join('，') + (s.cue ? `。${s.cue}` : '');
}

const n2 = v => Number(v).toFixed(2);
function helpers() {
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const dot_ = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const norm = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  const rightOf = fwd => norm([fwd[2], 0, -fwd[0]]);
  return { sub, dot_, rightOf };
}
