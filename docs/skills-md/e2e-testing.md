---
name: e2e-testing
description: e2e(tester-army/e2e) AI原生回归测试技能 — 中文界面实测有效,
  回放缓存省92%token; 适用于反复迭代的自有Web项目回归
---

# e2e — AI 原生端到端回归测试

[tester-army/e2e](https://github.com/tester-army/e2e)(5.6k★, v0.18, Apache-2.0): 用自然语言指挥
AI Agent 操作页面完成业务流, 配合传统 locator 精确断言; **agent 动作录制后零模型回放**,
界面没变就不烧 token —— 这是它相对 browser-use 的核心价值: 回归变成可积累的资产。

## 何时用 / 何时不用

- ✅ 自有 Web 项目会**反复迭代**(转录台/pose-game/水库网站类), 每次改版要回归
- ✅ 想把验证固化为"一条命令"并进 GitHub Actions
- ❌ 一次性页面检查(直接用 browser-use/截图更快); 不迭代的死项目(套件是负资产)

## 项目接入(5步)

1. `npm i e2e @e2e-dev/web @ai-sdk/openai-compatible ai@^7 playwright@<匹配版> -D`
   - **`ai` 是 optional peer 依赖, 不装会 MODEL_UNAVAILABLE**(报错文案会提示)
   - playwright 版本要匹配 @e2e-dev/web 的 playwright-core(如 1.63.0→chromium build 1243)
2. 浏览器: `PLAYWRIGHT_DOWNLOAD_HOST=https://npmmirror.com/mirrors/playwright/ npx playwright install chromium`
   - **国内必须设镜像**(默认从 Google CDN 下载会挂死); 遇 `__dirlock` 报错=上次强杀残留, 删掉即可
3. 写 `e2e.config.ts`(模板见下方)
4. 写 `tests/*.e2e.ts`
5. 跑: `npx e2e run`(全量) / `npx e2e run tests/xxx.e2e.ts`(单文件); 报告在 `.e2e/report.json`

## 配置模板(OpenAI兼容端点→智谱免费)

```ts
import type { E2EConfig } from 'e2e';
import { web } from '@e2e-dev/web';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';

const zhipu = createOpenAICompatible({
  name: 'zhipu',
  baseURL: 'https://open.bigmodel.cn/api/paas/v4',   // key走环境变量, 不落文件
  apiKey: process.env.ZHIPU_API_KEY ?? '',
});

export default {
  projectId: '<项目id>',
  tests: 'tests/**/*.e2e.ts',
  targets: [{ name: 'web', engine: web(), app: { url: 'http://127.0.0.1:7897' } }],
  timeout: 180_000,
  agents: {
    default: {
      model: zhipu.chatModel('glm-4.5-flash'),   // 免费+工具调用强, 中文界面实测好使
      judgmentTimeout: 90_000, maxSteps: 30, maxModelCalls: 40,
      context: '<给模型的页面结构中文说明, 提高控件匹配率>',
    },
  },
} satisfies E2EConfig;
```

## 测试模板(三段式: act→waitFor→locator)

```ts
import { test, expect } from 'e2e';

// 纯冒烟(零模型, 永远免费) + agent回归(首轮录制, 之后回放)
test('业务流', async ({ app, agent, screen }) => {
  await app.open('/');
  await agent.act('在"源文件夹"输入框填入 {folder}, 点击"开始"按钮',
    { params: { folder: 'C:/some/path' } });          // 参数化, 回放缓存才能命中
  await agent.waitFor('日志区出现"任务结束"', { timeout: 120_000 });
  await expect(screen.getByText('已存在').first()).toBeVisible();  // locator兜底
});
```

写法要点(实测教训):
- **目标语写界面上可见的文字**(按钮原文"▶ 导入并转录"就带表情符号写)
- 动态值必须走 `params`, 否则回放缓存永远 miss
- locator 断言注意 strict mode: 页面有多个同级元素时 `getByRole('heading')` 会炸, 要加 name 过滤
- 中转/判定模型都可能产生调用: 回放轮仍会有 1-2 次小调用(waitFor 判定), 属正常

## 实测数据(2026-10-06, 梵沐转录台中文界面)

| 轮次 | tokens | 模型调用 | 结果 |
|---|---|---|---|
| 首轮(录制) | 21.2k | 4 | act 全程 agent 驱动 |
| 回放轮 | 1.7k | 1 | **-92% token**, Cache: 1 replayed |

## 与我工作流的接法

- 用户说"给XX项目加回归测试" → 按上面5步接入, 用例=核心业务流1-3条
- 改完项目后 → `npx e2e run` 看报告; 失败先看 `.e2e/artifacts/**/screen.txt`(页面文本快照)
- 界面变了导致回放失效 → 重跑即自动重新录制, 无需手工清缓存
- 换模型: 任意 OpenAI 兼容端点(硅基流动/Agnes等)改 createOpenAICompatible 的 baseURL/model 即可
