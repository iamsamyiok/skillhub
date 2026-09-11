# FEEDBACK-CHANGES.md

## 反馈要点
用户 iamsamyiok 在 skill.html 详情页评论建议：下载区域仅有一个下载按钮，希望增加一个「复制下载链接」小按钮，点击后将当前技能的 zip 下载地址复制到剪贴板并提示已复制，样式与现有深色主题一致。

## 修改内容
- **public/app.js**（`initSkill()` 函数，约第 167 行）：
  - 在 `action-row` 的「下载 ZIP」按钮后新增 `<button class="btn btn-ghost" id="copy-zip-url">复制下载链接</button>`
  - 新增 `copy-zip-url` 按钮的点击事件：调用 `navigator.clipboard.writeText(dlUrl)` 复制 ZIP 下载地址，按钮文字临时改为「已复制 ✓」，1.5 秒后恢复
- **public/style.css**：无修改（复用已有的 `btn btn-ghost` 样式，与「tar.gz」和「查看 SKILL.md 原文」按钮保持一致）

## 未修改原因说明
- 无。反馈完全在前端范围内，已落实。
- 未引入任何新依赖或后端变更。

## 如何验证
1. 浏览器访问任意技能详情页，如 `/skill.html?id=book-to-skill`
2. 在「操作行」应看到：「下载 ZIP」(渐变主色)、「复制下载链接」(幽灵按钮)、「tar.gz」(幽灵按钮)
3. 点击「复制下载链接」，按钮文字临时变为「已复制 ✓」，1.5 秒后恢复
4. 粘贴剪贴板内容，应为该技能的 ZIP 下载 URL（静态模式为 `./downloads/<id>.zip`，API 模式为 `/api/skills/<id>/download`）
