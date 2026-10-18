# 白膜 HTML 规范 · Whitebox HTML Spec v1.0

> 本规范是「白膜工作台」的导入标准。**任何 AI（或人）生成的 3D 白膜 HTML，只要遵守本规范，就能被工作台一键导入、统一控制播放、截图和归档。**
> 规范仓库：https://github.com/Twdhsi-666/whitebox-workbench （spec/ 目录）

---

## 0. 一句话说明

白膜 HTML = **一个自包含的 .html 文件**：内联全部 CSS/JS，用 Three.js 搭一个 3D 白模场景，场景是一条**时间轴动画**（通常是一镜到底的镜头运动），并在文件里附上**元数据清单**和**标准控制接口**。

---

## 1. 文件要求

| 项 | 要求 |
|---|---|
| 格式 | 单个 `.html` 文件，UTF-8 编码，含 `<meta charset="UTF-8">` |
| 自包含 | 所有 CSS/JS 内联；禁止外部字体、外部图片、外链脚本 |
| 唯一依赖 | Three.js。importmap 写 `"three": "./assets/three.module.js"`。工作台导入时会把任何 CDN 地址自动重写为本地镜像，**保证离线可用** |
| 体积 | 建议 < 2MB |
| 交互卫生 | 禁止 `alert/confirm/prompt`、`document.write`、同步 XHR |
| 音频 | `__seek()` 内禁止播放声音（工作台是静音预览） |

---

## 2. 页面结构（舞台契约）

```html
<body>
  <div id="stage"></div>   <!-- 16:9 舞台，canvas 由 JS append 进来 -->
  <aside id="panel">…你自己的控制面板（可选）…</aside>
</body>
```

- `#stage`：`position:relative; overflow:hidden; aspect-ratio:16/9`，独立运行时居中显示。
- renderer 的 canvas **必须** `append` 到 `#stage`。
- `#panel`：可选。你自己的播放按钮、跳转按钮、时间轴都放这里。

### 嵌入模式（工作台里运行时）

工作台通过 iframe 加载你的文件，并预先设置 `window.__EMBED__ = true`。此时你必须：

1. **隐藏自己的面板**（`#panel` 整个移除或 `display:none`）——工作台有自己的控制条，不需要你的；
2. **`#stage` 铺满整个容器**（宽高 100%，取消 16:9 限制）；
3. **不要自动播放**（工作台控制播放/暂停/跳转）；
4. 隐藏一切"按 H 隐藏面板"之类的浮层提示。

```js
const EMBED = window.__EMBED__ === true;
if (EMBEDED_OK) { /* 见 example.html 的标准写法 */ }
```

标准写法（直接抄）：

```js
if (window.__EMBED__ === true) {
  document.getElementById('panel')?.remove();
  Object.assign(document.getElementById('stage').style, {
    width: '100%', height: '100%', maxWidth: 'none', maxHeight: 'none', aspectRatio: 'auto'
  });
  document.body.style.overflow = 'hidden';
}
```

（以上写法 `spec/example.html` 有完整可运行版本，直接照抄。）

---

## 3. 元数据清单（必须）

放在 `</body>` 前：

```html
<script type="application/json" id="whitebox-manifest">
{
  "spec": "whitebox-html/1.0",
  "title": "荒漠教室白模 · 一镜到底",
  "author": "DeepSeek",
  "duration": 15,
  "location": { "name": "巴东·神农中小学", "lat": 31.04, "lng": 110.34 },
  "shots": [
    { "t": 0,   "label": "推进" },
    { "t": 4.5, "label": "转场1" },
    { "t": 12,  "label": "产品特写" }
  ],
  "notes": "0–2s 正对老师推进；4.5–7.5s 第一次 360° 旋转……"
}
</script>
```

| 字段 | 必填 | 规则 |
|---|---|---|
| `spec` | ✅ | 必须等于 `"whitebox-html/1.0"` |
| `title` | ✅ | 场景标题 |
| `duration` | ✅ | 正数，秒。必须与 `window.__duration` 一致 |
| `author` | ➖ | 生成者署名，缺省记「无」 |
| `location` | ➖ | `{name, lat, lng}`， lat∈[-90,90]，lng∈[-180,180]，南纬/西经为负。**缺省时按导入顺序排在场景库** |
| `shots` | ➖ | `[{t, label}]`，t∈[0,duration]，按 t 升序。播放器用它画刻度 |
| `notes` | ➖ | 分镜说明，缺省「无」 |

---

## 4. 标准控制接口（必须全部实现）

放在 `</body>` 前、manifest 之前。**这 10 个是硬性要求，一个都不能少：**

```js
window.__ready   = true;                 // 场景就绪：首帧已可渲染
window.__seek    = function (t) { /* 跳到 t 秒，立刻渲染一帧，不播放 */ };
window.__grab    = function (t) { window.__seek(t); return renderer.domElement.toDataURL('image/jpeg', 0.92); };
window.__size    = function () { return renderer.domElement.width + 'x' + renderer.domElement.height; };
window.__glOk    = true;                 // WebGL 是否可用（生成时检测）
window.__play    = function () { /* 从当前 t 播放到 duration */ };
window.__pause   = function () { /* 暂停 */ };
window.__playing = false;                // 布尔值，播放中保持为 true
window.__duration = 15;                  // 秒，与 manifest.duration 一致
window.__getTime = function () { /* 返回当前时间轴位置（秒）*/ };
```

> 建议：`new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })` —— 开了它截图永不丢帧。

### 播放语义

1. **`__seek(t)` 幂等**：同一 t 调用多次画面一致；时间轴动画最好是 `t 的纯函数`（`camera.position = f(t)`），不要累积易碎状态。**`__seek` 必须同步更新 `__getTime()` 的返回值**（把当前时间变量一起改掉），否则工作台进度条会错位。
2. **`__seek` 后立即渲染一帧**，不能等下一帧 rAF 才出画（工作台截图依赖它）。
3. **`__play()`** 从当前 t 播到 `__duration` 自动停止，停止后 `__playing = false`。
4. **`__grab(t)`** 任意时刻调用都应返回该时刻的 JPEG dataURL（缩略图靠它）。
5. `__seek` 允许被高频调用（拖进度条时每帧一次），必须便宜。

---

## 5. 禁止事项

- ❌ 外链脚本 / 字体 / 图片（CDN 的 three 除外，且会被工作台重写成本地）
- ❌ three 之外的远程 import
- ❌ `alert / prompt / confirm`、`document.write`
- ❌ 自动播放声音
- ❌ 依赖 `localStorage` / `cookie` 保存状态（工作台多场景并行，会互相污染）

---

## 6. AI 生成后的自检清单

生成完必须逐项确认，任何一项不过，返工：

- [ ] `#whitebox-manifest` 存在，JSON 合法，`spec` 字段正确
- [ ] 10 个接口全部实现（`__ready/__seek/__grab/__size/__glOk/__play/__pause/__playing/__duration/__getTime`）
- [ ] `__grab(0)`、`__grab(duration/2)`、`__grab(duration)` 三次调用，画面**两两不同**
- [ ] `__seek(5)` 之后 `__getTime()` 返回 5（跳转与读数同步）
- [ ] `window.__EMBED__ = true` 时：面板消失、画布铺满、不自动播放
- [ ] 断网打开文件也能正常跑（three 走 `./assets/three.module.js`）
- [ ] 无任何 alert/外链资源

---

## 7. 版本

- v1.0（2026-10-17）：首发。时间轴 + 8 接口 + manifest + 嵌入模式。
- 兼容说明：工作台对**不满足本规范的旧文件**启动「兼容适配层」自动修补（虚拟时钟 + 面板隐藏 + 接口模拟），旧文件可直接导入，但控制精度以规范文件为佳。
