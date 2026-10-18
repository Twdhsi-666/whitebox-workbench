// 可摆放资产库。关键设计：资产 = 一组和场景预设**完全同样格式**的图元定义。
// 好处有三个：能被体检器查（悬空/穿模一样报）、能被 builder 直接建、语言模型照同一份 Schema 就能造新道具。
// 约定：parts 里的坐标以**资产自身原点**为基准，原点在**底面中心**（摆放时贴地，不用手算半高）。

export const ASSET_GROUPS = [
  { id: 'person', label: '人物' },
  { id: 'vehicle', label: '载具' },
  { id: 'furniture', label: '家具' },
  { id: 'building', label: '建筑' },
  { id: 'nature', label: '自然' },
  { id: 'street', label: '街景' },
  { id: 'prop', label: '道具' }
];

const box = (n, p, s, m) => ({ t: 'box', n, p, s, m });
const cyl = (n, p, s, m) => ({ t: 'cyl', n, s, p, m });
// 轮子：圆柱默认竖着，绕 Z 转 90° 才是横躺的轴（左右方向）
const wheel = (n, p, r, w, m = 'prop') => ({ t: 'cyl', n, p, s: [r, r, w, 16], m, rot: [0, 0, Math.PI / 2] });

function car(name, len, w, h, color) {
  const bodyH = h * 0.55, wheelR = 0.33;
  return [
    box(name + '_车身', [0, wheelR + bodyH / 2, 0], [w, bodyH, len], color),
    box(name + '_车顶', [0, wheelR + bodyH + h * 0.22, -len * 0.04], [w * 0.86, h * 0.44, len * 0.52], color),
    wheel(name + '_轮前左', [-w / 2, wheelR, len * 0.31], wheelR, 0.22),
    wheel(name + '_轮前右', [w / 2, wheelR, len * 0.31], wheelR, 0.22),
    wheel(name + '_轮后左', [-w / 2, wheelR, -len * 0.31], wheelR, 0.22),
    wheel(name + '_轮后右', [w / 2, wheelR, -len * 0.31], wheelR, 0.22)
  ];
}

const sph = (n, p, r, m) => ({ t: 'sphere', n, p, s: [r], m });

function chair(name) {
  return [
    box(name + '_座', [0, 0.45, 0], [0.44, 0.05, 0.44], 'furniture'),
    box(name + '_背', [0, 0.72, -0.19], [0.44, 0.5, 0.05], 'furniture'),
    box(name + '_腿左', [-0.18, 0.22, 0], [0.05, 0.44, 0.4], 'prop'),
    box(name + '_腿右', [0.18, 0.22, 0], [0.05, 0.44, 0.4], 'prop')
  ];
}

function table(name, w, d, h) {
  return [
    box(name + '_桌面', [0, h - 0.025, 0], [w, 0.05, d], 'furniture'),
    box(name + '_左腿', [-w / 2 + 0.06, (h - 0.05) / 2, 0], [0.06, h - 0.05, d - 0.12], 'prop'),
    box(name + '_右腿', [w / 2 - 0.06, (h - 0.05) / 2, 0], [0.06, h - 0.05, d - 0.12], 'prop')
  ];
}

function tree(name, trunkH, crownR) {
  return [
    cyl(name + '_树干', [0, trunkH / 2, 0], [0.14, 0.18, trunkH], 'prop'),
    sph(name + '_树冠', [0, trunkH + crownR * 0.72, 0], crownR, 'foliage')
  ];
}

export const ASSETS = [
  // ---- 人物 ----
  { id: 'figure_stand', label: '人·站', group: 'person', dims: [0.5, 1.75, 0.35], kind: 'figure', action: 'stand' },
  { id: 'figure_walk', label: '人·走', group: 'person', dims: [0.5, 1.75, 0.35], kind: 'figure', action: 'walk' },
  { id: 'figure_run', label: '人·跑', group: 'person', dims: [0.5, 1.75, 0.35], kind: 'figure', action: 'run' },
  { id: 'figure_sit', label: '人·坐', group: 'person', dims: [0.5, 1.35, 0.85], kind: 'figure', action: 'sit', seatY: 0.45 },
  { id: 'figure_point', label: '人·指', group: 'person', dims: [0.6, 1.75, 0.4], kind: 'figure', action: 'point' },
  { id: 'figure_cough', label: '人·咳嗽', group: 'person', dims: [0.55, 1.7, 0.45], kind: 'figure', action: 'cough' },
  { id: 'child', label: '小孩', group: 'person', dims: [0.4, 1.2, 0.3], kind: 'figure', action: 'stand', height: 1.2 },

  // ---- 载具 ----
  { id: 'car_sedan', label: '轿车', group: 'vehicle', dims: [1.8, 1.5, 4.5], parts: () => car('轿车', 4.5, 1.8, 1.5, 'building') },
  { id: 'car_suv', label: '越野车', group: 'vehicle', dims: [1.9, 1.85, 4.7], parts: () => car('越野车', 4.7, 1.9, 1.85, 'building') },
  { id: 'bus', label: '公交车', group: 'vehicle', dims: [2.55, 3.1, 10.5], parts: n => [
    box(n + '_车身', [0, 1.05, 0], [2.55, 2.1, 10.5], 'building'),
    box(n + '_窗带', [0, 1.85, 0], [2.6, 0.9, 9.6], 'glass'),
    wheel(n + '_轮前左', [-1.25, 0.5, 3.4], 0.5, 0.3),
    wheel(n + '_轮前右', [1.25, 0.5, 3.4], 0.5, 0.3),
    wheel(n + '_轮后左', [-1.25, 0.5, -3.4], 0.5, 0.3),
    wheel(n + '_轮后右', [1.25, 0.5, -3.4], 0.5, 0.3)
  ] },
  { id: 'motorbike', label: '摩托车', group: 'vehicle', dims: [0.75, 1.1, 2.1], parts: n => [
    box(n + '_车身', [0, 0.62, 0], [0.5, 0.34, 1.1], 'building'),
    box(n + '_把手', [0, 0.98, 0.42], [0.68, 0.06, 0.1], 'prop'),
    wheel(n + '_轮前', [0, 0.3, 0.85], 0.3, 0.1),
    wheel(n + '_轮后', [0, 0.3, -0.85], 0.3, 0.1)
  ] },
  { id: 'bicycle', label: '自行车', group: 'vehicle', dims: [0.6, 1.0, 1.7], parts: n => [
    wheel(n + '_轮前', [0, 0.35, 0.55], 0.35, 0.05),
    wheel(n + '_轮后', [0, 0.35, -0.55], 0.35, 0.05),
    box(n + '_车架', [0, 0.6, 0], [0.06, 0.06, 1.0], 'accent'),
    box(n + '_座', [0, 0.85, -0.2], [0.06, 0.06, 0.26], 'prop'),
    box(n + '_把', [0, 0.92, 0.42], [0.56, 0.05, 0.06], 'prop')
  ] },

  // ---- 家具 ----
  { id: 'desk', label: '书桌', group: 'furniture', dims: [1.2, 0.75, 0.6], parts: n => table(n, 1.2, 0.6, 0.75) },
  { id: 'dining_table', label: '餐桌', group: 'furniture', dims: [1.4, 0.75, 0.8], parts: n => table(n, 1.4, 0.8, 0.75) },
  { id: 'coffee_table', label: '茶几', group: 'furniture', dims: [1.1, 0.44, 0.6], parts: n => table(n, 1.1, 0.6, 0.44) },
  { id: 'chair', label: '椅子', group: 'furniture', dims: [0.44, 0.9, 0.44], parts: n => chair(n) },
  { id: 'sofa', label: '沙发', group: 'furniture', dims: [2.1, 0.85, 0.9], parts: n => [
    box(n + '_座', [0, 0.21, 0], [2.1, 0.42, 0.9], 'furniture'),
    box(n + '_背', [0, 0.62, -0.36], [2.1, 0.82, 0.18], 'furniture'),
    box(n + '_扶手左', [-0.96, 0.32, 0], [0.18, 0.64, 0.9], 'furniture'),
    box(n + '_扶手右', [0.96, 0.32, 0], [0.18, 0.64, 0.9], 'furniture')
  ] },
  { id: 'bed', label: '双人床', group: 'furniture', dims: [1.5, 0.55, 2.05], parts: n => [
    box(n + '_床架', [0, 0.15, 0], [1.5, 0.3, 2.05], 'furniture'),
    box(n + '_床垫', [0, 0.42, 0], [1.44, 0.24, 1.98], 'prop'),
    box(n + '_床头板', [0, 0.6, -0.98], [1.5, 1.2, 0.08], 'furniture')
  ] },
  { id: 'wardrobe', label: '衣柜', group: 'furniture', dims: [1.8, 2.2, 0.6], parts: n => [
    box(n + '_柜体', [0, 1.1, 0], [1.8, 2.2, 0.6], 'furniture'),
    box(n + '_门缝', [0, 1.1, 0.31], [0.03, 2.1, 0.02], 'prop')
  ] },
  { id: 'fridge', label: '冰箱', group: 'furniture', dims: [0.7, 1.8, 0.65], parts: n => [
    box(n + '_箱体', [0, 0.9, 0], [0.7, 1.8, 0.65], 'building'),
    box(n + '_分隔', [0, 1.15, 0.33], [0.68, 0.03, 0.02], 'prop')
  ] },
  { id: 'tv', label: '电视机', group: 'furniture', dims: [1.25, 0.75, 0.25], parts: n => [
    box(n + '_屏', [0, 0.62, 0], [1.25, 0.72, 0.06], 'building'),
    box(n + '_底座', [0, 0.12, 0], [0.4, 0.24, 0.25], 'prop')
  ] },

  // ---- 建筑 ----
  { id: 'tower', label: '高层楼', group: 'building', dims: [12, 30, 12], parts: n => [
    box(n, [0, 15, 0], [12, 30, 12], 'building'),
    box(n + '_幕墙', [0, 15, 6.05], [10, 26, 0.1], 'glass')
  ] },
  { id: 'low_building', label: '沿街平房', group: 'building', dims: [8, 3.6, 6], parts: n => [
    box(n, [0, 1.8, 0], [8, 3.6, 6], 'building'),
    box(n + '_门', [0, 1.02, 3.02], [0.95, 2.05, 0.08], 'prop'),
    box(n + '_窗', [2.4, 1.7, 3.02], [1.6, 1.2, 0.06], 'glass')
  ] },
  { id: 'wall', label: '围墙 3 米', group: 'building', dims: [3, 2, 0.24], parts: n => [box(n, [0, 1, 0], [3, 2, 0.24], 'wall')] },
  { id: 'pillar', label: '柱子', group: 'building', dims: [0.5, 3.2, 0.5], parts: n => [cyl(n, [0, 1.6, 0], [0.22, 0.25, 3.2, 16], 'wall')] },
  { id: 'stairs', label: '三级台阶', group: 'building', dims: [1.5, 0.45, 0.9], parts: n => [
    box(n + '_1', [0, 0.075, 0.3], [1.5, 0.15, 0.3], 'sidewalk'),
    box(n + '_2', [0, 0.225, 0], [1.5, 0.15, 0.3], 'sidewalk'),
    box(n + '_3', [0, 0.375, -0.3], [1.5, 0.15, 0.3], 'sidewalk')
  ] },
  { id: 'doorway', label: '门框', group: 'building', dims: [1.1, 2.15, 0.15], parts: n => [
    box(n + '_左', [-0.52, 1.05, 0], [0.1, 2.1, 0.15], 'wall'),
    box(n + '_右', [0.52, 1.05, 0], [0.1, 2.1, 0.15], 'wall'),
    box(n + '_上', [0, 2.1, 0], [1.14, 0.1, 0.15], 'wall')
  ] },

  // ---- 自然 ----
  { id: 'tree_broad', label: '阔叶树', group: 'nature', dims: [2.2, 5.6, 2.2], parts: n => tree(n, 2.6, 1.3) },
  { id: 'tree_small', label: '行道树', group: 'nature', dims: [1.6, 4.0, 1.6], parts: n => tree(n, 1.9, 0.95) },
  { id: 'pine', label: '松树', group: 'nature', dims: [1.8, 6.2, 1.8], parts: n => [
    cyl(n + '_干', [0, 0.7, 0], [0.14, 0.18, 1.4], 'prop'),
    cyl(n + '_层1', [0, 2.0, 0], [0.2, 0.95, 1.6], 'foliage'),
    cyl(n + '_层2', [0, 3.4, 0], [0.15, 0.7, 1.4], 'foliage'),
    cyl(n + '_层3', [0, 4.7, 0], [0.05, 0.45, 1.2], 'foliage')
  ] },
  { id: 'bush', label: '灌木', group: 'nature', dims: [1.1, 0.85, 1.1], parts: n => [sph(n, [0, 0.4, 0], 0.5, 'foliage')] },
  { id: 'rock', label: '石头', group: 'nature', dims: [1.0, 0.6, 0.8], parts: n => [box(n, [0, 0.28, 0], [1.0, 0.56, 0.8], 'prop')] },

  // ---- 街景 ----
  { id: 'streetlamp', label: '路灯', group: 'street', dims: [0.3, 6.0, 0.3], parts: n => [
    cyl(n + '_杆', [0, 3, 0], [0.08, 0.1, 6.0, 12], 'prop'),
    box(n + '_臂', [0, 5.95, 0.35], [0.1, 0.1, 0.8], 'prop'),
    sph(n + '_灯头', [0, 5.85, 0.7], 0.16, 'accent')
  ] },
  { id: 'traffic_light', label: '红绿灯', group: 'street', dims: [0.35, 4.2, 0.35], parts: n => [
    cyl(n + '_杆', [0, 1.9, 0], [0.09, 0.11, 3.8, 12], 'prop'),
    box(n + '_灯箱', [0, 3.6, 0.25], [0.28, 0.86, 0.28], 'building'),
    sph(n + '_红', [0, 3.9, 0.4], 0.1, 'accent'),
    sph(n + '_绿', [0, 3.3, 0.4], 0.1, 'foliage')
  ] },
  { id: 'crosswalk', label: '斑马线一组', group: 'street', dims: [4.5, 0.02, 3.6], parts: n => [0, 1, 2, 3, 4, 5].map(i =>
    box(n + '_' + (i + 1), [0, 0.012, -1.5 + i * 0.62], [4.5, 0.02, 0.45], 'sidewalk')) },
  { id: 'bench', label: '长凳', group: 'street', dims: [1.6, 0.75, 0.5], parts: n => [
    box(n + '_座', [0, 0.42, 0], [1.6, 0.07, 0.45], 'furniture'),
    box(n + '_背', [0, 0.6, -0.2], [1.6, 0.34, 0.06], 'furniture'),
    box(n + '_腿左', [-0.7, 0.2, 0], [0.08, 0.4, 0.42], 'prop'),
    box(n + '_腿右', [0.7, 0.2, 0], [0.08, 0.4, 0.42], 'prop')
  ] },
  { id: 'bin', label: '垃圾桶', group: 'street', dims: [0.45, 0.9, 0.45], parts: n => [cyl(n, [0, 0.45, 0], [0.22, 0.19, 0.9], 'prop')] },
  { id: 'barrier', label: '路障', group: 'street', dims: [1.8, 1.0, 0.4], parts: n => [
    box(n + '_板', [0, 0.72, 0], [1.8, 0.32, 0.06], 'accent'),
    box(n + '_腿左', [-0.75, 0.28, 0], [0.08, 0.56, 0.4], 'prop'),
    box(n + '_腿右', [0.75, 0.28, 0], [0.08, 0.56, 0.4], 'prop')
  ] },

  // ---- 道具 ----
  { id: 'box_small', label: '纸箱', group: 'prop', dims: [0.6, 0.5, 0.4], parts: n => [box(n, [0, 0.25, 0], [0.6, 0.5, 0.4], 'furniture')] },
  { id: 'medicine_box', label: '药盒（主角）', group: 'prop', dims: [0.14, 0.09, 0.1], accent: true, parts: n => [box(n, [0, 0.045, 0], [0.14, 0.09, 0.1], 'accent')] },
  { id: 'cup', label: '水杯', group: 'prop', dims: [0.08, 0.12, 0.08], parts: n => [cyl(n, [0, 0.06, 0], [0.04, 0.04, 0.12, 14], 'prop')], floatOK: true },
  { id: 'tripod', label: '摄像机三脚架', group: 'prop', dims: [0.6, 1.6, 0.6], parts: n => [
    cyl(n + '_架', [0, 0.7, 0], [0.04, 0.06, 1.4, 10], 'prop'),
    box(n + '_机身', [0, 1.48, 0], [0.22, 0.16, 0.34], 'building'),
    box(n + '_镜头', [0, 1.48, 0.24], [0.12, 0.12, 0.16], 'prop')
  ] },
  { id: 'umbrella', label: '遮阳伞', group: 'prop', dims: [2.4, 2.4, 2.4], parts: n => [
    cyl(n + '_杆', [0, 1.2, 0], [0.04, 0.04, 2.4, 10], 'prop'),
    cyl(n + '_伞面', [0, 2.3, 0], [0.02, 1.2, 0.36], 'furniture')
  ] },
  { id: 'plant_pot', label: '盆栽', group: 'prop', dims: [0.4, 0.95, 0.4], parts: n => [
    cyl(n + '_盆', [0, 0.16, 0], [0.17, 0.14, 0.32], 'furniture'),
    sph(n + '_冠', [0, 0.62, 0], 0.3, 'foliage')
  ] }
];

export function assetById(id) { return ASSETS.find(a => a.id === id) || null; }

// 生成一份可直接塞进 project.customObjects 的定义（group，原点在摆放点）
export function instantiate(asset, point, opt = {}) {
  const rot = opt.rot || 0, scale = opt.scale || 1;
  const n = opt.name || (asset.label + (opt.seq || 1));
  if (asset.kind === 'figure') {
    return { t: 'figure', n, p: [point[0], 0, point[1]], facing: rot, action: asset.action || 'stand',
      height: asset.height || 1.75, seatY: asset.seatY, scale };
  }
  const parts = (asset.parts || (() => []))(n).map(d => ({
    ...d,
    p: d.p.map(v => v * scale),
    s: d.s.map(v => v * scale)
  }));
  return { t: 'group', n, p: [point[0], 0, point[1]], rot: [0, rot, 0], children: parts, __asset: asset.id };
}

// 体检用的占位尺寸（米），幽灵预览和"摆完有没有悬空"都要用
export function assetFootprint(asset) { return asset.dims || [0.6, 0.6, 0.6]; }
