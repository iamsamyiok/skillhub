# 软件宣传视频制作 + B站发布 完整流程

为 Node.js Web 项目制作「真实录屏 + AI 中文配音 + 自动合成」的宣传视频，并发布到 B 站。全流程可由 Agent 全自动完成，唯一需要用户参与的环节是 B 站扫码登录（和投稿后的 AI 声明勾选）。

## 适用场景

- 为软件项目制作功能演示视频并发布 B 站
- 任何「网页应用操作录屏 → 配音 → 合成 → 投稿」的流水线需求
- 参考实现位于项目 `video/` 目录（storyboard.json / record.js / tts.js / compose.js / build.sh / bili_login.mjs），skill 附件 `scripts/` 是同一套文件的快照

## 新项目复用：env 零拷贝模式（推荐）

tts.js / compose.js 支持 `STORYBOARD` 与 `OUT_DIR` 环境变量，**新项目无需复制管线代码**，只需新建一个分镜目录 + 一个专属 record.js：

```bash
mkdir -p video/<项目>/ video/out/<项目>
# 写 video/<项目>/storyboard.json + video/<项目>/record.js（复用管线核心，重写动作层）
export STORYBOARD=$PWD/video/<项目>/storyboard.json OUT_DIR=$PWD/video/out/<项目>
node video/<项目>/record.js                 # 帧存 OUT_DIR/frames/<镜id>/
node video/tts.js && node video/compose.js  # 产物隔离在 OUT_DIR（tts/、frames/、clip/、final.mp4）
```

两脚本拼路径的约定：tts.js 写 `OUT_DIR/tts/`，compose.js 读 `OUT_DIR/tts/`；record.js 帧目录必须是 `OUT_DIR/frames/<镜id>/`（compose 按 `frames/` 读取）。三个目录名任何一个对不上都会在合成时报 `No such file or directory`。

## 前置依赖（一次性安装）

```bash
# 录屏浏览器（playwright + 无头 chromium）
npm install -g playwright && playwright install chromium-headless-shell
# chromium 系统依赖（Debian；apt 官方源失效时换镜像源）
export DEBIAN_FRONTEND=noninteractive
apt-get install -y libglib2.0-0 libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libasound2 libpango-1.0-0 libcairo2 fonts-noto-cjk fontconfig qrencode

# 视频合成（ffmpeg-static 无 drawtext 滤镜，靠 libass 烧字幕；路径全局固定）
npm install -g ffmpeg-static ffprobe-static
# 二进制位置：/usr/local/lib/node_modules/ffmpeg-static/ffmpeg 与 /usr/local/lib/node_modules/ffprobe-static/bin/linux/x64/ffprobe

# 中文 TTS 配音
pip3 install --break-system-packages edge-tts

# B站投稿工具（Rust 静态二进制）
curl -sL -o /tmp/opencode/biliup.tar.xz https://github.com/biliup/biliup-rs/releases/download/v0.2.4/biliupR-v0.2.4-x86_64-linux.tar.xz
tar xf /tmp/opencode/biliup.tar.xz -C /tmp/opencode
# 可执行文件：/tmp/opencode/biliupR-v0.2.4-x86_64-linux/biliup
```

注意：ffmpeg-static 的 libass 依赖 fontconfig 配置。若 `Fontconfig error` 导致字幕渲染空白，需安装 fontconfig 包；项目已自带最小配置 `video/assets/fontconfig.conf`，compose.js 会自动设置 `FONTCONFIG_FILE` 指向它。

## 管线总览

```mermaid
graph TD
    A["storyboard.json 分镜表"] --> B["record.js 逐镜录屏"]
    B --> C["out/frames/ 每镜12fps帧序列"]
    A --> D["tts.js 逐镜配音"]
    D --> E["out/tts/ mp3+srt"]
    C --> F["compose.js 合成"]
    E --> F
    F --> G["out/final.mp4 + final.srt + final.ass"]
    G --> H["biliup-rs 投稿"]
```

## 第1步：分镜表 storyboard.json

结构：`meta`（分辨率、录屏端口、`endCard`）+ `shots[]`：

```json
{
  "meta": { "resolution": [1280, 720], "fps": 12, "endCard": ["npx <包名>", "github.com/<user>/<repo>"] },
  "shots": [ ... ]
}
```

每个分镜：

```json
{
  "id": "s3",                    // 帧目录名 out/frames/s3
  "title": "AI对话建图",
  "minSec": 14,                  // 最短时长；成片段长 = max(配音时长+1, minSec)
  "timeoutMs": 480000,           // 该镜总超时（AI写入等待长的分镜要加大）
  "narration": "口播稿文字……",    // edge-tts 配音源（字段名必须是 narration，tts.js 按此读取；写成 voice 会得到 undefined 报错）
  "actions": [                   // 顺序执行的录屏动作
    { "wait": 3000 },
    { "type": "...", "text": "..." },
    { "type": "click", "sel": "#selector" },
    { "type": "click", "sel": "#openBtn",
      "check": "document.getElementById('myMask').classList.contains('show')",
      "checkDelay": 900,
      "fallback": "document.getElementById('cfgModal')?.classList.remove('show'); openMyMask()" },
    { "type": "direct", "js": "openStaff()", "pauseMs": 800 },   // 万能逃生舱：直调页面 JS
    { "move": "#selector" },     // 光标移动动画
    { "ripple": true },          // 点击涟漪动画
    { "waitAgentDone": true },   // 等 AI 回复完成（480s 内轮询）
    { "shot": "s4" }             // 结束标记
  ]
}
```

写口播稿与动作的对应原则：每个分镜配音 20~60 字（约 8~20 秒），动作时长略长于配音；数字 id 深链（如 `#entity=6`）从 demo 数据映射查询数据库得到。

## 第2步：录屏 record.js

原理（这是整套管线的核心，勿改回旧方案）：
- **CDP Page.startScreencast 事件驱动收帧**，按时间戳重采样成 12fps 帧序列。Playwright 自带 recordVideo 在软渲染下时间戳失真（13 秒动作录出 145 秒）；逐帧 screenshot 太慢（1.3 秒/帧）
- 录制分辨率 1280x720（SwiftShader 软渲染的帧率折衷），compose 阶段统一 scale 到 1920x1080
- 每镜独立 `browser.newContext()`，虚拟光标动画（`_vcursor` div + `_vripple` 涟漪）叠加在页面上

关键经验：
- **点击必须用 playwright 原生 `locator.click()`**（自带 actionability 检查），光标动画只做 vMove + ripple 装饰。裸 `mouse.down/up` 在软渲染高负载下会被页面吞掉
- **click 前先 `scrollIntoView({ block: 'center' })`**：弹窗内容超屏时，目标按钮在视口外会导致 click 遮挡判定超时（报 `intercepts pointer events`）
- **onclick 被页面 JS 换绑/吞掉的兜底**：症状是 `locator.click` 成功但弹窗没开（locator 点中了元素，处理函数却没跑）。用 `check` 表达式点击后验证预期 DOM 状态，不满足时 `fallback` JS 兜底——注意 fallback 里要**先关掉误开的叠层弹窗**（如 `classList.remove('show')`）再直调打开函数，否则旧弹窗遮罩会拦截后续所有点击。确定流程时也可直接用 `direct` 动作直调页面函数
- **浮层延迟弹出类 UI（自检/引导层）必须「等出现再跳过」**：直接扫一遍找不到就 continue 会提前返回，浮层几秒后弹出会挡住后续所有交互
- WebGL 3D 画布 `canvas.toDataURL` 返回黑帧（渲染后 buffer 清空），帧源只能用 screencast
- 动作后留足 settle 等待；打开大浮层后等 2~4 秒；等 AI 完成 `waitAgentDone` 超时给 480 秒
- 帧有效性判据：黑帧/空白帧 < 20KB，有效帧 100KB+；**浅色界面（白底应用）有效帧只有 25~50KB**，阈值按界面底色调整，勿套用深色标准
- 帧目录统一 `out/frames/<id>/`（与 env 模式的 `OUT_DIR/frames/<id>/` 一致）。整理/重录前先 `ls` 验证目录结构再动手——**mv 到已存在的目录会变成嵌套子目录**（`mv raw frames` 得到 `frames/raw/`），清理嵌套时严禁盲目 `rm -rf`，会连有效帧一起删掉
- 目标应用若有「无人值守自动退出」类机制（如演示页全关 1 分钟自杀），录制期间必须用环境参数禁用（agents-chat 例：`AGENTS_CHAT_AUTOSTOP_IDLE_MS=86400000`），否则录到一半服务没了
- 录制前的 mock/演示数据定制：直接改全局安装包内的 demo 模块（如 `/usr/local/lib/node_modules/<pkg>/app/mock/*.js`）可去演示水印、定制回复文案；注意 npm 重装会覆盖，录制期间勿重装

用法：

```bash
node video/record.js              # 录全部分镜（已有帧的镜跳过）
node video/record.js --only s3,s7 # 只录指定镜（逗号分隔）
```

录屏前先起 demo 实例（build.sh 会自动做；手动调试时）：

```bash
PORT=3777 node bin/cli.js --demo &   # 一次性临时目录，不污染真实数据
node video/record.js
```

## 第3步：配音 tts.js

```bash
node video/tts.js [--force]
```

- 每镜 `narration` 文字 → `out/tts/{id}.mp3` + `{id}.srt`（zh-CN-XiaoxiaoNeural）
- edge-tts 7.x 无 `--words-in-cue` 参数；字幕即配音文本分句
- 配音必须与画面动作节奏对齐：改口播稿后要重看对应分镜动作时长是否匹配

## 第4步：合成 compose.js

```bash
node video/compose.js
```

每镜流程：帧序列 12fps → 按需变速（long 镜加速）→ `tpad` 末帧定格补齐 / `-t` 截断到目标段长 → concat。然后：

- 音轨：每镜 mp3 `apad` 补静音到段长 → concat → mux 进成片（成片必须有音轨，投稿前用 volumedetect 验证 mean/max 音量非 -91dB）
- 字幕：合并各镜 srt（加 offset）生成 `final.srt`（投稿时可作 CC 上传）；同时生成 `final.ass` 烧录进画面（Default 样式 + 片尾卡 EndCard 样式）
- 片尾卡：`ass` 滤镜渲染两行大字（`meta.endCard[0]` 安装命令大字 + `meta.endCard[1]` 项目地址小字，叠加在末镜后 58% 时段）；未配置 endCard 时回退 local-knowledge-graph 默认文案——**换项目必须检查 meta.endCard，否则片尾会烧上别的项目的地址**
- 输出 1920x1080 30fps H.264 CRF 21 + AAC

踩坑记录：
- ffmpeg-static 无 `drawtext`（没编 freetype），文字叠加一律走 `ass`/`subtitles` 滤镜 + libass
- libass 需要 fontconfig；系统装了 fontconfig 包后仍报 `Failed to load fontconfig fonts` 时，用项目自带 `video/assets/fontconfig.conf`（`FONTCONFIG_FILE` 环境变量）
- 字幕/片尾卡渲染验证法：对比目标时段与空白时段同区域平均亮度（signalstats YAVG），差值 >2 说明文字已渲染
- Node 子进程调用时路径硬编码全局 ffmpeg/ffprobe 位置（npm -g 安装路径）

验证成片（视觉识别走用户的 vision 模型，或抽帧后确认）：

```bash
ffmpeg-static的ffmpeg -i out/final.mp4   # 确认 Duration 与双 Stream（Video+Audio）
ffmpeg-static的ffmpeg -ss <时刻> -i out/final.mp4 -frames:v 1 帧图.jpg   # 抽帧
```

vision 审查方法论（agents-chat 视频实测教训）：
- **全帧问「有没有字幕」会误判**：烧录字幕在画面底部，vision 极易把它读成界面输入框文字，回复「无字幕」。正确做法：`crop=1920:120:0:940` 裁出底部字幕条 + 提问「逐字转录图中所有文字」，转录出 narration 文案即字幕渲染成功
- 片尾卡居中显示（`\an5`），验证要裁中部区域（`crop=1920:400:0:340`），裁底部只会看到输入框
- 镜头内容动态可用客观指标验证：同镜头尾两帧 `blend=all_mode=difference` 后 signalstats YAVG >30 说明画面在剧烈变化（消息滚动/动画执行）；vision 对「当前是什么模式/页面」的描述也可能出错，重要结论都要程序化复核
- 多帧串行 vision 请求容易超 shell 超时：小图（crop 后）比全帧快很多，每批 2~3 帧，max_tokens 控制在 150~300
- cue 空档属正常：段长 = max(配音+1s, minSec)，配音结束后有几秒无字幕，抽到空档帧别误判为字幕丢失

## 一键管线 build.sh

```bash
bash video/build.sh [--only s1,s3] [--force]
```

自动：起 `--demo` 实例（mkdtemp 一次性目录，PORT=3777）→ record → tts → compose → 关实例（trap 清理）。

## 第5步：B站扫码登录 bili_login.mjs

```bash
node video/bili_login.mjs [二维码输出路径] [cookies输出路径]
# 默认 video/out/bilibili_login_qr.png 与 video/out/cookies.json
```

把二维码图片告知用户（「项目文件」面板打开扫码）。脚本自动完成：官方扫码 API 生成二维码 → 2 秒轮询（90 次）→ 拿 web cookie → TV 授权链（auth_code → 用 SESSDATA+bili_jct confirm → poll）换 access_token → 生成 biliup-rs 凭据。

要点：
- 二维码有效期 180 秒，过期（code 86038）重跑
- `biliup login` 交互菜单需要 TTY，后台环境跑不了，必须走本脚本的 API 方式
- B站 App API 签名：`sign=md5(参数串+appsec)`，最终 body 必须是 `参数串&sign=<md5>`——**漏掉 `sign=` 键名会报 code=-3 签名错误**；body 勿被二次 URL 编码（勿再过 URLSearchParams）
- BiliTV appkey/appsec 为 B 站公开常量：`4409e2ce8ffd12b8` / `59b43e04ad6965f34319062b478f83dd`
- cookies.json 是 biliup-rs 的 LoginInfo 结构，必需字段 `cookie_info`、`token_info.access_token`、`platform`

## 第6步：投稿 biliup-rs

```bash
cd <cookies.json所在目录>
/tmp/opencode/biliupR-v0.2.4-x86_64-linux/biliup upload <视频路径> \
  --title "标题（80字内）" \
  --tid 171 \
  --copyright 1 \
  --tag "标签1,标签2,标签3" \
  --cover <封面.jpg路径> \
  --desc "简介（可含分段时间戳、命令、GitHub链接、AI配音声明）"
```

- **biliup 只读执行目录（CWD）下的 `cookies.json`**：登录产物在 `video/out/cookies.json`，投稿前必须 `cd video/out` 或把 cookies 复制到 CWD；报 `open cookies file: cookies.json ... No such file or directory` 就是这个原因。cookies.json 建议另留一份备份（如 `/tmp/opencode/cookies.json`），access_token 30 天有效，过期重跑 bili_login.mjs
- 常用分区 tid：171=知识区-计算机技术、122=科技区-野生技术协会、231=知识区-设计·创意
- 封面：从成片抽一帧画面信息量最大的帧（演示画面饱满、消息气泡丰富处比开场空页面更合适），`-q:v 2` 高质量 16:9
- 上传约 3.5MB/s，1 分钟视频 20MB 内几秒传完；完成后日志输出 `bvid`（BV号）即投稿成功
- biliup 可能警告「客户端接口已失效，将使用APP接口」，属正常，投稿仍成功

## 投稿后必须人工完成

提醒用户到 [B站创作中心-稿件管理](https://member.bilibili.com/platform/upload-manager/article) 编辑稿件：
1. **勾选「AI 生成内容」声明（AI 配音）**——投稿 API 无法代勾，这是 2025-09《AI 生成合成内容标识办法》合规要求（简介文字声明只是兜底）
2. 检查封面、分区、标签是否符合预期

## 合规红线

- 画面必须是真实软件录屏；AI 配音需声明；BGM 用 B 站创作中心自带曲库（投稿时不放 BGM）
- demo 数据使用虚构/公共领域内容，避免真实人物肖像与版权素材

## 制作新视频的改造清单

首选 **env 零拷贝模式**（见开头）：

1. `mkdir -p video/<项目> video/out/<项目>`
2. 写 `video/<项目>/storyboard.json`：分镜数、`narration` 口播稿、动作序列、`minSec`、`meta.endCard`（安装命令 + 项目地址，**必填**，防止烧上旧项目片尾）
3. 写 `video/<项目>/record.js`：复用管线核心（CDP screencast 收帧 + 12fps 重采样 + 虚拟光标），只重写项目相关的动作辅助函数与演示实例启动参数；页面有自定义弹窗函数时优先用 `click.check/fallback` 或 `direct` 动作
4. `export STORYBOARD=... OUT_DIR=...` 后跑 record → tts → compose
5. 抽帧验证（crop 字幕条转录法 + 帧差动态验证）→ `cd video/out && biliup upload` → 提醒用户勾 AI 声明

旧模式（复制整个 `video/` 再改 compose.js 片尾卡等硬编码）仍可用，但容易漏改片尾卡文案，已被 meta.endCard 参数化取代。
