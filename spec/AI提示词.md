# 给其他 AI 的提示词 · 生成可导入白膜工作台的 HTML

> 用法：把下面整段（从「--- 提示词开始 ---」到「--- 提示词结束 ---」）复制，连同你的场景需求一起发给任意 AI（DeepSeek / ChatGPT / Claude / 通义 / 文心……）。
> AI 返回的 .html 文件，直接拖进「白膜工作台」窗口即可导入。
> 完整规范：https://github.com/Twdhsi-666/whitebox-workbench/blob/main/spec/%E7%99%BD%E8%86%9CHTML%E8%A7%84%E8%8C%83.md

--- 提示词开始 ---

你将生成一个「白膜 HTML」3D 场景文件（用于 AI 视频生成前的镜头逻辑白模）。必须严格遵守以下规范《白膜 HTML 规范 v1.0》，任何一项不满足都算失败。

【我的场景需求】
（在这里写你的需求，例如：荒漠教室一镜到底 15 秒，包含推进、产品滑入、360° 旋转、产品特写四个阶段）

【硬性要求】
1. 输出单个完整 .html 文件，UTF-8，所有 CSS/JS 内联，自包含。
2. Three.js 是唯一依赖，用 importmap 引入："three": "./assets/three.module.js"（或其他 three 地址，工作台会自动重写为本地镜像）。
3. 页面结构：`<div id="stage">`（16:9 舞台，canvas append 进去）+ 可选 `<aside id="panel">`（你自己的控制面板）。
4. 在 `</body>` 前放元数据清单：
   <script type="application/json" id="whitebox-manifest">
   {"spec":"whitebox-html/1.0","title":"标题","author":"你的名字","duration":15,
    "location":{"name":"取景地名","lat":31.04,"lng":110.34},
    "shots":[{"t":0,"label":"起幅"},{"t":7.5,"label":"落幅"}],
    "notes":"分镜说明"}
   </script>
   规则：spec 必须等于 "whitebox-html/1.0"；duration 为正数；location 可省略（省略则记 {"name":"无","lat":0,"lng":0}）；shots 按 t 升序。
5. 在 manifest 之前实现 8 个标准接口（一个都不能少）：
   window.__ready = true;                                  // 放在全部初始化之后
   window.__seek = function(t){ /* 跳到 t 秒，立即渲染一帧，不播放 */ };
   window.__grab = function(t){ window.__seek(t); return renderer.domElement.toDataURL('image/jpeg',0.92); };
   window.__size = function(){ return renderer.domElement.width+'x'+renderer.domElement.height; };
   window.__glOk = true;                                   // 生成时实际检测 WebGL
   window.__play = function(){ /* 从当前 t 播到 duration */ };
   window.__pause = function(){ /* 暂停 */ };
   window.__playing = false;                               // 播放中保持 true
   window.__duration = 15;                                 // 与 manifest.duration 一致
   window.__getTime = function(){ return curT; };          // 当前时间轴位置（秒）
6. 动画架构：写一个 `function renderAt(t)`，把所有随时间变化的状态（相机路径、物体运动、显隐）写成 t 的纯函数。`__seek` 必须把当前时间变量一起改掉（`curT = clamp(t); renderAt(curT);`），保证 `__getTime()` 与画面同步。禁止依赖累积的易碎状态。
7. 嵌入模式：文件开头检测 `if (window.__EMBED__ === true)`，此时移除 #panel、让 #stage 宽高铺满 body、不自动播放、去掉一切浮层提示。
8. 禁止：alert/confirm/prompt、document.write、外链脚本/字体/图片、three 之外的远程 import、localStorage、自动播放声音。
9. 场景本身：白模风格（无贴图，MeshStandardMaterial 纯色 + 阴影即可），镜头运动要有明确的分镜设计（推进/环绕/摇移/硬切），duration 内节奏有变化。
10. 自检后再输出：确认 __grab(0)、__grab(duration/2)、__grab(duration) 三次调用画面两两不同；确认嵌入模式下 panel 消失、画布铺满。

【输出格式】
直接输出完整 HTML 代码，不要省略任何部分，不要用注释代替实现。

--- 提示词结束 ---
