---
name: video-producer
version: 1.0.0
category: 视频创作
tags: [视频, 配音, 录屏, 分镜, demo视频, 教学视频, 字幕, ffmpeg, playwright]
description: 从分镜板（storyboard.json）批量生产 App 演示/教学视频。五步回路 lint → 配音 → 录制 → 合成 → 质检，设计令牌化字幕/片尾，bgm 自动闪避。适用词：视频、配音、录制、分镜、demo 视频、教学视频、成片。
license: MIT
---

# video-producer 视频生产管线

给"活的 Web 应用"（真实 DOM/WebGL 交互页面）批量产出成品视频。流程借鉴 HyperFrames 的工程化思想（lint-first、组合契约、draft 快速回路、pitfalls 文档先行），适配了"页面不可 seek"的现实。

## 何时用

- 适合：产品演示、功能教学、操作指引——页面真实交互 + AI 配音 + 字幕 + 片尾卡。
- 适合：同一应用批量产出多语言/多主题版本（改分镜板与令牌即可）。
- 不适合：已有剪辑素材只想拼接（直接用 ffmpeg）；需要逐帧物理精确的动画（用 hyperframes 类可 seek 引擎）。

## 快速开始

```bash
# SKILL 指向本技能目录（下载 zip 解压后的 video-producer/）
SKILL=path/to/video-producer
BOARD=path/to/storyboard.json

node $SKILL/scripts/lint.mjs $BOARD            # 1. 门禁：先让 lint 全绿
node $SKILL/scripts/snapshot.mjs $BOARD --at 1,3   # 2. 抽帧：低成本确认画面方向（可选）
node $SKILL/scripts/tts.mjs $BOARD             # 3. 配音：按句生成，时长精确
node $SKILL/scripts/record.mjs $BOARD          # 4. 录制：逐镜截帧 + overlay 注入
node $SKILL/scripts/compose.mjs $BOARD --draft --allow-silent  # 5. 草片：快速看节奏
node $SKILL/scripts/qc.mjs $BOARD --draft      # 6. 质检
# 节奏确认后去掉 --draft 出正式片，再 qc --baseline 对比上次
```

环境依赖：Node 20.11+、playwright / ffmpeg-static / ffprobe-static（全局，脚本自动解析）、字体需含中文（如 WenQuanYi Zen Hei）；`SILICONFLOW_API_KEY` 可选（配了走 CosyVoice2，没配走 edge-tts）。录制前先把被录应用跑起来（开发服务器或任意静态服务），录制期间保持运行。

## 17 条实践教训（先读这个再写代码）

P1. TTS 音色必须全格式 `{model}:{name}`，如 `FunAudioLLM/CosyVoice2-0.5B:diana`。裸名报 20047 Invalid voice。
P2. TTS 长文本会静默截断（90 字只读出 3 秒）。tts.mjs 已按句切分再拼接，narration 每句仍建议 ≤120 字。
P3. edge-tts 间歇性 `NoAudioReceived` 且产物 0 字节。已内置产物大小校验 + 退避重试；连续失败时配 `SILICONFLOW_API_KEY`。
P4. ffmpeg concat 清单里的路径相对清单文件自身解析，与 CWD 无关。脚本已统一用绝对路径写清单。
P5. ffmpeg-static 精简版没有 drawtext/freetype。字幕、片尾卡全部走 ASS 文件（libass 内建）。
P6. libass 渲染中文依赖 fontconfig 字体。环境已有 WenQuanYi Zen Hei；换机器先 `fc-list | grep -i wqy` 验证。
P7. 软渲染逐帧截图很慢（swiftshader CPU 光栅化）。默认 720p 采集，compose 统一放大到成片分辨率，别在 record 里追 1080p。
P8. Chromium 无 GPU 环境必须显式 `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader`，少一个都黑屏或崩。
P9. CDP screencast 每帧必须 ack，且**只在页面重绘时吐帧**：静态页面（纯 wait 镜头）帧时钟会坍缩、时长缩水。record.mjs 已注入 2px 无限动画"脉冲元素"强制合成器持续出帧；帧数仍异常时用 `--only <shot> --mode capture` 隔离。失败自动清理残帧，直接重跑即可。
P10. minSec 与 narration 时长天然漂移。成片段长 = max(配音时长 + 1.0s, minSec)，多余帧末尾定格（tpad clone）。
P11. overlay 是墙钟契约：`start/duration` 相对"该镜首次 goto 完成"那一刻（t0）。渲染器就绪等待（texturesReady）可能吃掉数秒且每次不同，overlay 演出会随帧率波动——要求逐帧精确的元素别放 overlay，放 ASS。
P12. 页面是活应用，无内部时间轴，不可 seek。snapshot.mjs 是"预算重放"近似，同参数两次运行画面允许细微漂移；要确定性就全程 record。
P13. 缺配音会阻断。草片调试加 `--allow-silent`（静音垫齐），正式片必须先跑通 tts.mjs。
P14. 先出 draft（960x540 / crf30 / veryfast）看节奏，确认后再精修。直接渲染 1080p 中速档试节奏是最大时间浪费。
P15. loudnorm 单遍模式输出 192kHz 采样率，直接进 sidechaincompress/amix 会时长错乱（实测 25.8s 混成 23.0s）。compose 已在其后接 aresample=44100，自改滤镜链时勿删。
P16. ffmpeg 滤镜图里一个输出标签只能被消费一次。voice 既要当侧链又要进 amix 时必须 `asplit` 分身，否则报 "Stream specifier ... matches no streams"（报错信息完全没提真正原因）。
P17. overlay 默认白字是为深色场景设计的，白底页面上会"渲染了但看不见"。令牌已接通：在分镜板同目录放 design.json 覆写 `overlay.ink` 为深色即可（参考 examples/design-light.json）。像素级验收别只看 DOM 存在性，要抽帧数像素。

## 分镜板契约（storyboard.json）

```jsonc
{
  "meta": {
    "resolution": [1280, 720],        // 成片分辨率；draft 恒为 960x540
    "fps": 30,                         // 成片帧率；采集 fps 默认 12
    "bgm": "./assets/bgm.mp3",         // 可选，相对分镜板
    "bgmVolume": 0.35,                 // 闪避前的垫乐音量
    "endCard": ["主文案", "副文案"]     // 可选，末镜片尾卡
  },
  "shots": [{
    "id": "kebab-case-id",
    "name": "中文镜头名",
    "narration": "旁白。按句切分。",   // 每句 ≤120 字；决定字幕与段长
    "minSec": 7,                       // 段长下限
    "speed": 1,                        // 采集帧变速系数，>1 加速
    "actions": [                       // 顺序执行
      { "type": "goto", "url": "http://localhost:8000/app" },   // 必为首动作
      { "type": "click", "sel": "#btn" },
      { "type": "click", "sel": "#maybeModal", "optional": true }, // 元素不存在/隐藏时静默跳过
      { "type": "fill", "sel": "#editor", "text": "内容" },
      { "type": "press", "key": "Enter" },
      { "type": "direct", "js": "window.__APP__.reset()" },
      { "type": "wait", "ms": 2000 },
      { "type": "dragCanvas", "dx": 200, "dy": 0, "ms": 800 },
      { "type": "dragSlider", "sel": "#slider", "to": 0.6 }
    ],
    "overlays": [{                     // 可选，HTML 模板注入
      "template": "title.html",        // 相对分镜板，缺省回落到 skill assets/templates/
      "start": 0, "duration": 3.5,     // 相对该镜 t0（见 P11）
      "vars": { "title": "标题", "sub": "副题" }
    }]
  }]
}
```

动作细节：`goto` 会等 `__WORLD__.renderer` 与 `texturesReady.done`（worldgen 页面契约，120s 超时兜底）；普通页面只需 load 事件即可。`fill` 支持 contenteditable。`dragSlider` 的 `to` 是 0~1 比例。

## overlay 组合契约

模板 = 自包含 HTML 片段（内联 style + keyframes，类名以 `vpx-` 前缀隔离），record.mjs 按 `start/duration` 注入/移除。`vars` 经 {{var}} / {{#var}}..{{/var}} 渲染。内置模板：

- `title.html`：居中标题卡（淡入上移）
- `lower-third.html`:左下角横条（左滑入）

新模板放进分镜板同目录即可，无需改 skill。设计令牌（色板/字幕/片尾/overlay）在 `assets/design.json`：

- ASS 字幕样式全部由令牌生成——改视觉只改令牌。
- overlay 模板经 CSS 变量（`--vpx-overlay-ink` 等）取令牌；分镜板同目录放 `design.json` 可覆写（浅色页面覆写 `overlay.ink`，参考 `examples/design-light.json`）。
- 动作字段补充：`click/fill` 支持 `optional: true`（元素缺失静默跳过）；`pauseMs/delayMs/settleMs` 可微调节奏。

## 产物一览

| 阶段 | 产物 |
|---|---|
| record | `out/frames/<id>/%06d.jpg` + `out/frames/_meta.json` |
| tts | `out/tts/<id>.mp3` + `.srt` + `index.json` |
| compose | `out/final.mp4`（或 final-draft.mp4）、`final.srt`、`final.ass`、`timeline.json` |
| qc | `out/qc.json`（ok + checks[]，可进 CI） |

失败排查顺序：lint 报错 → 对应分镜修；record 帧数异常 → `--only` 单镜 + `--mode capture`；compose 报缺文件 → 上游产物时间戳（record 增量跳过已存在帧，重录用 `--force`）。

## 与 HyperFrames 的边界

HyperFrames 把视频拆成可 seek 的确定性组合（HTML data-* 契约、时间轴任意跳转渲染），适合逐帧可控的动画。本管线录制的是活应用：确定性只来自"固定的动作序列 + 固定的采集节拍"，组合层（ASS 字幕、overlay、音频闪避）负责可精确控制的部分。两层契约清晰分工：墙钟敏感的元素用 overlay（HTML，灵活），时间敏感的元素用 ASS（逐 cue 精确）。
