# AI 完善提示词（让任意 AI 接手扩展本项目）

> 用法：把下面**从分隔线到文末**的内容整段复制，连同本项目的全部源文件一起发给你的 AI（DeepSeek / ChatGPT / Claude / 通义……），然后用一句话说明你想加什么。AI 即可在理解项目结构的前提下直接产出可用的修改。

---

## 项目背景（必读）

「白膜工作台」是一个**纯静态、零构建、零运行时依赖**的 Web 应用：AI 视频制作前的 3D 白膜（whitebox）场景搭建与分镜预演工具。技术栈：原生 HTML/CSS/JS（ES Modules）+ Three.js r160 本地镜像（importmap 引入，无 CDN、无 npm、无打包）。

## 硬性约束（修改时不得违反）

1. **不引入任何构建工具、框架、npm 包、CDN 外链**——保持双击 `启动.bat` 或任意静态服务器即可跑；
2. Three.js 只经 importmap 以 ES Module 使用（`import * as THREE from 'three'`），**不要假设存在全局 `THREE`**；
3. 新增 `.js` 逻辑文件一律 ES Module，并在 `index.html` 用 `<script type="module">` 按文档序引入；
4. 所有新增数据默认存 localStorage，经 `js/store.js` 持久化；
5. 注释与 UI 文案用简体中文；代码风格跟随现有文件（2 空格缩进、单引号）；
6. 改完后必须能在 `python -m http.server` 下直接验证，不允许「需要先 npm install」。

## 目录结构与关键文件

```
index.html            三视图：#view-entry（入口）/ #view-editor（编辑器）/ #view-library（场景库卡片网格）
css/workbench.css     全部样式；编辑器浅色主题令牌集中在 #view-editor 内的 --ed-* CSS 变量
js/app.js             主应用：三视图路由 switchView()、入口渲染、编辑器集成、导入流程
js/editor.js          EditorApp 类：轨道相机（球坐标 r/phi/theta + 阻尼）、选中/拖拽/检查器/
                      机位（EDITOR_SHOT_SIZES 全景24/中景13/近景7/特写3.6）、序列化、captureThumb
js/assetlib.js        33 个程序化白膜资产：helper 为 mat/box/cyl/sph/cone，导出 window.WB_ASSETS
                      （{id,name,cat,make():THREE.Group}）+ window.WB_ASSET_CATS
js/scenes.js          6 个预设环境：每个 build() 返回 {objects, sky, fog:[c,near,far], sun, cam, tgt}
js/importer.js        导入分级（规范/兼容）+ CDN 依赖重写 + 桥接注入
js/store.js           localStorage 持久化 + 导出/导入项目 JSON
spec/                 白膜 HTML 规范 v1.0 + 可复制给 AI 的提示词
```

## 常见扩展任务与做法

**A. 加资产（最常用）**
在 `js/assetlib.js` 里仿照现有写法新增函数，用 helper 组合基础几何体（原点在物体底部中心），然后注册进 `window.WB_ASSETS`：

```js
function myCar() {
  const g = new THREE.Group();
  g.add(box(2.2, 0.5, 1.0, CLAY, 0, 0.55, 0));      // 车身
  g.add(cyl(0.32, 0.32, 0.24, DARK, -0.7, 0.32, 0.5)); // 轮
  return g;
}
// 注册：{ id: 'mycar', name: '我的车', cat: 'vehicles', make: myCar }
```

cat 只能是 people / vehicles / buildings / nature / props 五类（`window.WB_ASSET_CATS`）。

**B. 加预设环境**
在 `js/scenes.js` 新增 `function envXxx(){ ... return {objects, sky, fog, sun, cam, tgt}; }` 并注册进 `window.WB_ENVIRONMENTS`；入口环境卡由 `js/app.js` 的 `renderEntry()` 自动生成，还需在 `ENV_PREVIEWS` 里补一张手绘 SVG 预览（仿照现有 6 张）。

**C. 改 UI**
所有颜色改 `css/workbench.css` 中 `#view-editor` 内的 `--ed-panel / --ed-bg / --ed-accent` 等 CSS 变量，不要散落硬编码颜色。

**D. 扩展白膜 HTML 规范**
规范在 `spec/白膜HTML规范.md`（v1.0：manifest + 10 个标准接口）。若扩展，必须同步更新 `spec/AI提示词.md`、`js/importer.js` 的校验逻辑与 `js/adapter.js` 桥接，三处保持一致。

**E. 验证修改**
本地起服务后用浏览器打开，按此清单过一遍：入口 6 张环境卡 → 进编辑器资产轨 5 按钮 → 开资产坞有缩略图 → 点资产能放置 → 检查器数值可改 → 保存机位可跳回 → 顶栏保存后「我的场景」出现缩略图 → 刷新后仍在。

## 当前已知的待完善方向（任选）

- 资产精度：现有 33 个资产是基础几何体组合，可加更复杂的组合建模；
- 镜头运动：机位目前是静态快照，可做关键帧插值（相机路径动画）；
- 移动端触屏适配；
- 资产坞搜索/收藏/最近使用；
- 夜景/雨天等更多环境与灯光氛围；
- 导入规范 v2（分镜数据从 manifest 扩展到时间线）。

---

**给 AI 的指令模板**（复制后填你的需求）：

> 这是「白膜工作台」项目的全部源文件。请严格遵守上述硬性约束，帮我完成：〔你的需求，如：在资产坞新增 10 个交通工具类资产，风格与现有黏土白模一致〕。完成后告诉我改了哪些文件、如何本地验证。
