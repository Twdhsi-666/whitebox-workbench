// 人形：圆柱体上身 + 球头。骨架在髋部，四肢绕关节转，程序化动作查 ACTIONS 表。
import * as THREE from '../vendor/three.module.js';

const F = {
  leg: 0.47,      // 占身高比例
  torso: 0.36,
  neck: 0.075,
  head: 0.062,    // 头半径
  torsoR: 0.088,
  limbR: 0.030,
  legR: 0.038,
  arm: 0.36,
  shoulder: 0.115
};

function limb(len, r, mat) {
  const g = new THREE.Group();
  const geo = new THREE.CylinderGeometry(r, r * 0.85, len, 14);
  const m = new THREE.Mesh(geo, mat);
  m.position.y = -len / 2;
  m.castShadow = true;
  g.add(m);
  g.userData.len = len;
  return g;
}

export function makeFigure(opt = {}) {
  const h = opt.height || 1.75;
  const mat = opt.material;
  const legLen = F.leg * h, torsoLen = F.torso * h, armLen = F.arm * h;

  const root = new THREE.Group();
  root.name = opt.name || 'figure';

  const hips = new THREE.Group();
  hips.position.y = legLen;
  root.add(hips);

  const torsoGeo = new THREE.CylinderGeometry(F.torsoR * h * 0.82, F.torsoR * h, torsoLen, 18);
  const torso = new THREE.Mesh(torsoGeo, mat);
  torso.position.y = torsoLen / 2;
  torso.castShadow = true;
  hips.add(torso);

  const neckY = torsoLen + F.neck * h * 0.5;
  const headGroup = new THREE.Group();
  headGroup.position.y = neckY;
  hips.add(headGroup);
  const head = new THREE.Mesh(new THREE.SphereGeometry(F.head * h, 20, 16), mat);
  head.position.y = F.head * h;
  head.castShadow = true;
  headGroup.add(head);
  // 鼻子：一个朝前的小方块，用来在顶视图里一眼看出人物朝向
  const nose = new THREE.Mesh(new THREE.BoxGeometry(0.05 * h, 0.03 * h, 0.06 * h), mat);
  nose.position.set(0, F.head * h, F.head * h * 0.95);
  headGroup.add(nose);

  const mkArm = side => {
    const a = limb(armLen, F.limbR * h, mat);
    a.position.set(side * F.shoulder * h, torsoLen - 0.02 * h, 0);
    hips.add(a);
    return a;
  };
  const mkLeg = side => {
    const l = limb(legLen, F.legR * h, mat);
    l.position.set(side * 0.055 * h, 0, 0);
    hips.add(l);
    return l;
  };

  const parts = {
    root, hips, torso, head, headGroup, nose,
    armL: mkArm(-1), armR: mkArm(1), legL: mkLeg(-1), legR: mkLeg(1),
    h, legLen, torsoLen, armLen
  };
  parts.state = { pose: 'stand', phase: 0, facing: 0 };
  root.userData.figure = parts;
  return parts;
}

const TAU = Math.PI * 2;

// 每个动作：cycle = 循环秒数（0 表示单次、由 u:0→1 播完），apply(p, u, ctx) 摆关节。
// u 在循环动作里是相位 0..1，在单次动作里是进度 0..1。
export const ACTIONS = {
  stand: { cycle: 4, label: '站立', apply(p, u) {
    const b = Math.sin(u * TAU);
    p.hips.rotation.set(0, 0, 0);
    p.torso.rotation.x = b * 0.012;
    p.armL.rotation.x = b * 0.03; p.armR.rotation.x = -b * 0.03;
    p.armL.rotation.z = 0.06; p.armR.rotation.z = -0.06;
    p.legL.rotation.x = 0; p.legR.rotation.x = 0;
    p.headGroup.rotation.x = -b * 0.01;
  } },
  walk: { cycle: 1.05, label: '走路', travel: 1.25, apply(p, u) {
    const a = u * TAU, s = Math.sin(a), c = Math.cos(a);
    p.legL.rotation.x = s * 0.55; p.legR.rotation.x = -s * 0.55;
    p.armL.rotation.x = -s * 0.42; p.armR.rotation.x = s * 0.42;
    p.armL.rotation.z = 0.09; p.armR.rotation.z = -0.09;
    p.hips.position.y = p.legLen + Math.abs(c) * 0.028 * p.h - 0.014 * p.h;
    p.hips.rotation.z = c * 0.04;
    p.torso.rotation.x = 0.05;
    p.headGroup.rotation.x = -0.04 + Math.sin(a * 2) * 0.02;
  } },
  run: { cycle: 0.72, label: '跑步', travel: 3.2, apply(p, u) {
    const a = u * TAU, s = Math.sin(a);
    p.legL.rotation.x = s * 0.95; p.legR.rotation.x = -s * 0.95;
    p.armL.rotation.x = -s * 0.85; p.armR.rotation.x = s * 0.85;
    p.armL.rotation.z = 0.12; p.armR.rotation.z = -0.12;
    p.hips.position.y = p.legLen + Math.abs(Math.cos(a)) * 0.05 * p.h - 0.02 * p.h;
    p.torso.rotation.x = 0.24;
    p.headGroup.rotation.x = -0.2;
  } },
  turn: { cycle: 0, label: '转身', apply(p, u) {
    const e = 1 - Math.pow(1 - u, 3);
    p.root.rotation.y = p.state.facing0 + e * (p.state.facing1 - p.state.facing0);
    p.armL.rotation.z = 0.2 * Math.sin(u * Math.PI);
    p.armR.rotation.z = -0.2 * Math.sin(u * Math.PI);
    p.torso.rotation.y = Math.sin(u * Math.PI) * 0.18;
  } },
  sit: { cycle: 0.9, label: '坐下', apply(p, u, ctx) {
    const seat = ctx && ctx.seatY != null ? ctx.seatY : 0.45;
    const e = Math.min(1, u);
    p.hips.position.y = seat + 0.02;
    p.legL.rotation.x = -1.24 * e; p.legR.rotation.x = -1.24 * e;
    p.torso.rotation.x = 0.06 * e;
    p.armL.rotation.x = -0.5 * e; p.armR.rotation.x = -0.5 * e;
    p.armL.rotation.z = 0.14; p.armR.rotation.z = -0.14;
  } },
  standup: { cycle: 0.9, label: '起身', apply(p, u, ctx) {
    const seat = ctx && ctx.seatY != null ? ctx.seatY : 0.45;
    const e = u * u * (3 - 2 * u);
    p.hips.position.y = seat + 0.02 + (p.legLen - seat - 0.02) * e;
    p.legL.rotation.x = -1.45 * (1 - e); p.legR.rotation.x = -1.45 * (1 - e);
    p.torso.rotation.x = 0.22 * (1 - e);
    p.armL.rotation.x = -0.5 * (1 - e); p.armR.rotation.x = -0.5 * (1 - e);
  } },
  reach: { cycle: 1.2, label: '伸手拿', apply(p, u) {
    const e = Math.sin(u * Math.PI);
    p.armR.rotation.x = -1.35 * e; p.armR.rotation.z = -0.1 * e;
    p.torso.rotation.x = 0.18 * e;
    p.headGroup.rotation.x = 0.12 * e;
    p.armL.rotation.x = 0.15 * e;
  } },
  pass: { cycle: 1.4, label: '递给对方', apply(p, u) {
    const e = Math.sin(u * Math.PI);
    p.armR.rotation.x = -1.15 * e; p.armL.rotation.x = -0.95 * e;
    p.armR.rotation.z = -0.22 * e; p.armL.rotation.z = 0.22 * e;
    p.torso.rotation.x = 0.14 * e;
    p.headGroup.rotation.x = 0.06 * e;
  } },
  cough: { cycle: 0.55, label: '咳嗽', apply(p, u) {
    const j = Math.sin(u * TAU * 2) * (1 - u);
    p.torso.rotation.x = 0.2 + 0.16 * Math.abs(j);
    p.headGroup.rotation.x = -0.1 + 0.2 * j;
    p.armR.rotation.x = -1.0; p.armR.rotation.z = -0.35;
    p.armL.rotation.x = -0.2;
  } },
  nod: { cycle: 1.1, label: '点头', apply(p, u) {
    p.headGroup.rotation.x = Math.sin(u * TAU) * 0.22;
    p.torso.rotation.x = Math.sin(u * TAU) * 0.03;
  } },
  shake: { cycle: 1.2, label: '摇头', apply(p, u) {
    p.headGroup.rotation.y = Math.sin(u * TAU) * 0.32;
    p.headGroup.rotation.x = -0.05;
  } },
  point: { cycle: 1.3, label: '指向', apply(p, u) {
    const e = Math.min(1, u * 2.2);
    p.armR.rotation.x = -1.5 * e; p.armR.rotation.z = -0.05;
    p.headGroup.rotation.y = 0.12 * e;
    p.torso.rotation.y = 0.1 * e;
    p.armL.rotation.x = 0.1;
  } },
  bend: { cycle: 1.4, label: '弯腰', apply(p, u) {
    const e = Math.sin(u * Math.PI);
    p.torso.rotation.x = 0.85 * e;
    p.headGroup.rotation.x = -0.3 * e;
    p.hips.position.y = p.legLen - 0.06 * p.h * e;
    p.armL.rotation.x = 0.5 * e; p.armR.rotation.x = 0.5 * e;
  } },
  look: { cycle: 3.4, label: '环顾', apply(p, u) {
    p.headGroup.rotation.y = Math.sin(u * TAU) * 0.5;
    p.torso.rotation.y = Math.sin(u * TAU) * 0.12;
    p.headGroup.rotation.x = Math.sin(u * TAU * 2) * 0.05;
  } },
  wave: { cycle: 1.2, label: '招手', apply(p, u) {
    p.armR.rotation.x = -2.5; p.armR.rotation.z = -0.5;
    p.headGroup.rotation.y = Math.sin(u * TAU) * 0.1;
    const w = Math.sin(u * TAU * 2) * 0.35;
    p.armR.children[0].rotation.z = w;
  } }
};

// 把 pose 摆成静态（给缩略图和"这一帧谁在做什么"用）
export function applyAction(parts, actionId, u, ctx) {
  const a = ACTIONS[actionId] || ACTIONS.stand;
  // 循环动作复位：走路/跑步会把髋抬起来，切换动作时必须归零，否则人卡在半空
  if (a.cycle) parts.hips.position.y = parts.legLen;
  parts.state.pose = actionId;
  parts.state.phase = u;
  a.apply(parts, u, ctx);
  return a;
}

export function resetFigure(parts) {
  parts.hips.position.y = parts.legLen;
  for (const k of ['hips', 'torso', 'headGroup', 'armL', 'armR', 'legL', 'legR']) {
    parts[k].rotation.set(0, 0, 0);
  }
  parts.armL.children[0].rotation.set(0, 0, 0);
  ACTIONS.stand.apply(parts, 0);
}

export const ACTION_LIST = Object.entries(ACTIONS).map(([id, a]) => ({ id, label: a.label, cycle: a.cycle, travel: a.travel || 0 }));
