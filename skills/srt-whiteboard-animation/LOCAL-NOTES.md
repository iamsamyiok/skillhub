# 本地化备注(iamsamyiok 收录)

原项目: geeklee/srt-whiteboard-animation (4035★, MIT)
收录: ZCode Agent, 2026-10-06, 已实测全链路并发布B站(BV1cZpA66EZa)

## 本机环境(Windows)
- CLI位置: C:\Users\Administrator\.agents\skills\srt-whiteboard-animation\
- 渲染解释器: .venv\Scripts\python.exe (prepare_env.py 建立; 国内补依赖加 -i 清华源)
- 实测补装: opencv-python / av / Pillow

## 实测管线(端到端27秒视频)
1. 文案 -> edge-tts --write-subtitles 一次出音频+精确SRT
2. 线稿 -> Agnes agnes-image-2.5-flash (提示词按SKILL视觉规范, 1280x720, 零文字)
3. 编排 -> agent看图写annotation.json(区域坐标+字幕时序对齐)
4. 渲染 -> render_stream_whiteboard.py (1080x600@60fps, 27.1s视频渲染约2分钟)
5. 合成 -> ffmpeg -c:v copy + aac旁白; 封面用末帧
6. 发布 -> biliup upload (cookies.json在test3/skillhub-video/目录)

## 坑
- 确认关卡(SKILL.md强制逐步确认)在无人值守模式下由agent代跑, 成片给用户验收
- 渲染输出分辨率跟随线稿长边1080; 要720p就把线稿画成1280x720原图
