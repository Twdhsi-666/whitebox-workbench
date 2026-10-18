// 缓动曲线：公式逐条抄自 tweenjs/tween.js 的 src/Easing.ts（Robert Penner 系），本地留档 vendor/easing/tweenjs-Easing.ts。
// smoothstep 不是抄的，是你 mods 里 19 个白膜页面自己在用的那一条（updateCamera 里的 const e = smoothstep(...)）。

export const EASE = {
  linear: t => t,
  quadOut: t => t * (2 - t),
  quadInOut: t => ((t *= 2) < 1 ? 0.5 * t * t : -0.5 * (--t * (t - 2) - 1)),
  cubicIn: t => t * t * t,
  cubicOut: t => --t * t * t + 1,
  cubicInOut: t => ((t *= 2) < 1 ? 0.5 * t * t * t : 0.5 * ((t -= 2) * t * t + 2)),
  quartOut: t => 1 - --t * t * t * t,
  quartInOut: t => ((t *= 2) < 1 ? 0.5 * t * t * t * t : -0.5 * ((t -= 2) * t * t * t - 2)),
  expoOut: t => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)),
  expoIn: t => (t <= 0 ? 0 : Math.pow(2, 10 * (t - 1))),
  sineInOut: t => -(Math.cos(Math.PI * t) - 1) / 2,
  smoothstep: t => t * t * (3 - 2 * t),
  backOut: t => { const s = 1.70158; return --t * t * ((s + 1) * t + s) + 1; }
};

export const EASE_LIST = [
  { id: 'linear', label: '匀速', note: '机械感，轨道车' },
  { id: 'smoothstep', label: '平滑', note: '首尾都减速，你页面在用这条' },
  { id: 'cubicInOut', label: '缓入缓出', note: '标准电影感' },
  { id: 'cubicOut', label: '缓出', note: '起步快、到位稳' },
  { id: 'expoOut', label: '急缓出', note: '甩镜落点' },
  { id: 'sineInOut', label: '正弦', note: '轻微呼吸感' },
  { id: 'backOut', label: '回弹', note: '只在道具滑入时用' }
];

export const ease = id => EASE[id] || EASE.smoothstep;
