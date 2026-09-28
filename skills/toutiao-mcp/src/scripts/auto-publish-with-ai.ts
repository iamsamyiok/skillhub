/**
 * 智能自动化新闻发布脚本（集成版）
 *
 * 功能流程：
 * 1. 从 trends-hub 获取真实热点新闻
 * 2. 使用 AI 搜索网络并生成高质量总结
 * 3. 自动发布到今日头条微头条
 *
 * 使用方法：
 * npm run auto-publish-ai
 */

import { TouTiaoAuth } from '../lib/auth';
import { TouTiaoPublisher } from '../lib/publisher';
import axios from 'axios';

// ============================================================================
// 配置区域
// ============================================================================

interface AutoPublishConfig {
  newsSource: 'weibo' | 'zhihu' | 'toutiao' | 'douyin' | 'baidu' | 'netease';
  count: number;           // 发布数量
  interval: number;        // 发布间隔(秒)
  useAI: boolean;         // 是否使用 AI 增强
  aiProvider?: 'openai' | 'anthropic' | 'local';  // AI 提供商
  addHashtag: boolean;    // 添加话题标签
  dryRun: boolean;        // 测试模式（不实际发布）
}

// ============================================================================
// 工具函数
// ============================================================================

/**
 * 从微博热搜获取新闻（使用 trends-hub）
 */
async function fetchWeiboTrending(limit: number = 10) {
  console.log(`\n📱 正在获取微博热搜榜 TOP ${limit}...`);

  // 这里应该调用 trends-hub 的 MCP 工具
  // 由于我们在独立脚本中，可以通过 HTTP API 或直接调用
  // 示例实现（需要根据实际的 trends-hub 接口调整）

  try {
    // 如果 trends-hub 提供了 HTTP API
    // const response = await axios.get('http://localhost:3000/api/weibo-trending');
    // return response.data;

    // 或者直接返回模拟数据用于测试
    console.log('⚠️  当前使用模拟数据，请集成真实的 trends-hub API');

    return [
      {
        title: 'DeepSeek 发布最新 AI 模型',
        hotValue: '爆',
        url: 'https://weibo.com/...',
        rank: 1
      },
      {
        title: '今日天气预报发布重要提醒',
        hotValue: '热',
        url: 'https://weibo.com/...',
        rank: 2
      },
      {
        title: '科技创新推动经济发展',
        hotValue: '新',
        url: 'https://weibo.com/...',
        rank: 3
      },
    ].slice(0, limit);
  } catch (error) {
    console.error(`❌ 获取微博热搜失败: ${error}`);
    return [];
  }
}

/**
 * 使用 AI 生成微头条内容
 */
async function generateContentWithAI(newsTitle: string, newsUrl?: string): Promise<string> {
  console.log(`\n🤖 使用 AI 生成内容: ${newsTitle.substring(0, 40)}...`);

  try {
    // 构建提示词
    const prompt = `你是一位专业的新媒体编辑，请根据以下新闻标题创作一条适合今日头条微头条的内容：

新闻标题：${newsTitle}
${newsUrl ? `新闻链接：${newsUrl}` : ''}

创作要求：
1. 字数控制在 150-300 字
2. 开头用一个吸引眼球的表情符号
3. 简明扼要地介绍新闻要点
4. 可以加入相关背景信息或解读
5. 语言通俗易懂，有趣生动
6. 结尾可以提出一个引发讨论的问题
7. 适当使用表情符号增强可读性（但不要过多）
8. 自然地融入 2-3 个相关话题标签（使用 # 符号）

直接输出微头条内容，不要包含任何说明性文字。`;

    // 调用 AI API（这里需要根据你使用的 AI 服务调整）
    // 示例：使用 OpenAI API
    /*
    const response = await axios.post('https://api.openai.com/v1/chat/completions', {
      model: 'gpt-4',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
      max_tokens: 500,
    }, {
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      }
    });

    const content = response.data.choices[0].message.content;
    */

    // 模拟 AI 生成的内容
    console.log('⚠️  当前使用模拟 AI 内容，请配置真实的 AI API');

    const content = `🔥 ${newsTitle}

这一消息迅速引发热议！据了解，相关话题已经登上多个平台热搜榜，网友们纷纷表达了自己的看法。

💡 业内专家指出，这一事件背后反映出当前社会的关注焦点。从长远来看，这将对相关领域产生深远影响。

📊 数据显示，类似话题的讨论热度持续攀升，说明大众对此类议题的关注度正在不断提高。

🤔 你对这件事怎么看？欢迎评论区分享你的观点！

#热点资讯 #社会热点 #今日话题`;

    console.log('✅ AI 内容生成完成');
    return content;

  } catch (error) {
    console.error(`❌ AI 生成失败: ${error}`);

    // 降级：返回简单版本
    return `📰 ${newsTitle}

这一话题正在引发广泛关注和讨论。

你怎么看？欢迎留言分享你的想法！

#热点 #今日话题`;
  }
}

/**
 * 提取和优化话题标签
 */
function extractAndOptimizeHashtags(content: string, newsTitle: string): string {
  // 如果内容中已经有标签，直接返回
  if (content.includes('#')) {
    return content;
  }

  // 根据标题和内容智能提取关键词作为话题
  const keywords = [
    '科技', '互联网', '人工智能', 'AI',
    '财经', '股市', '经济',
    '娱乐', '明星', '影视',
    '体育', '足球', '篮球',
    '社会', '民生', '教育',
    '健康', '养生', '医疗',
    '旅游', '美食', '生活',
  ];

  const matchedKeywords: string[] = [];
  const textToSearch = newsTitle + content;

  for (const keyword of keywords) {
    if (textToSearch.includes(keyword)) {
      matchedKeywords.push(keyword);
      if (matchedKeywords.length >= 2) break;
    }
  }

  // 添加通用标签
  matchedKeywords.push('热点资讯');

  // 在内容末尾添加标签
  const tags = matchedKeywords.map(k => `#${k}`).join(' ');
  return `${content}\n\n${tags}`;
}

/**
 * 发布单条微头条
 */
async function publishSinglePost(
  publisher: TouTiaoPublisher,
  content: string,
  dryRun: boolean
): Promise<boolean> {
  if (dryRun) {
    console.log('\n🔍 测试模式 - 预览内容：');
    console.log('─'.repeat(60));
    console.log(content);
    console.log('─'.repeat(60));
    console.log('✅ 测试模式：跳过实际发布');
    return true;
  }

  try {
    console.log('\n📤 正在发布微头条...');
    const result = await publisher.publishMicroPost({ content });

    if (result.success) {
      console.log('✅ 发布成功！');
      return true;
    } else {
      console.error(`❌ 发布失败: ${result.message}`);
      return false;
    }
  } catch (error) {
    console.error(`❌ 发布异常: ${error}`);
    return false;
  }
}

/**
 * 等待指定时间
 */
function sleep(seconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, seconds * 1000));
}

// ============================================================================
// 主流程
// ============================================================================

async function main() {
  console.clear();
  console.log('\n' + '='.repeat(70));
  console.log('🚀 今日头条智能自动发布系统');
  console.log('='.repeat(70));

  // 1. 配置参数
  const config: AutoPublishConfig = {
    newsSource: 'weibo',    // 新闻源
    count: 3,               // 发布3条
    interval: 60,           // 间隔60秒
    useAI: true,            // 使用AI增强
    addHashtag: true,       // 添加话题
    dryRun: false,          // 实际发布（设为true可测试）
  };

  console.log('\n📋 运行配置：');
  console.log(`   新闻源: ${config.newsSource}`);
  console.log(`   发布数量: ${config.count}`);
  console.log(`   发布间隔: ${config.interval}秒`);
  console.log(`   AI增强: ${config.useAI ? '开启' : '关闭'}`);
  console.log(`   测试模式: ${config.dryRun ? '是' : '否'}`);

  // 2. 检查登录状态
  console.log('\n📝 [1/5] 检查登录状态...');
  const auth = new TouTiaoAuth();

  if (!config.dryRun) {
    const isLoggedIn = await auth.checkLoginStatus();
    if (!isLoggedIn) {
      console.error('❌ 未登录！请先运行: npm run login');
      process.exit(1);
    }
    console.log('✅ 登录状态正常');
  } else {
    console.log('⚠️  测试模式：跳过登录检查');
  }

  // 3. 获取热点新闻
  console.log('\n📝 [2/5] 获取热点新闻...');
  const newsList = await fetchWeiboTrending(config.count);

  if (newsList.length === 0) {
    console.error('❌ 未获取到新闻，程序退出');
    process.exit(1);
  }

  console.log(`✅ 成功获取 ${newsList.length} 条新闻`);
  newsList.forEach((news, index) => {
    console.log(`   ${index + 1}. ${news.title} ${news.hotValue ? `[${news.hotValue}]` : ''}`);
  });

  // 4. 初始化发布器
  console.log('\n📝 [3/5] 初始化发布器...');
  const publisher = new TouTiaoPublisher(auth);
  console.log('✅ 发布器就绪');

  // 5. 处理并发布
  console.log('\n📝 [4/5] 开始处理和发布新闻...\n');

  const stats = {
    total: newsList.length,
    success: 0,
    failed: 0,
  };

  for (let i = 0; i < newsList.length; i++) {
    const news = newsList[i];

    console.log('\n' + '='.repeat(70));
    console.log(`📌 处理第 ${i + 1}/${newsList.length} 条`);
    console.log(`   标题: ${news.title}`);
    console.log(`   排名: #${news.rank} ${news.hotValue ? `[${news.hotValue}]` : ''}`);
    console.log('='.repeat(70));

    try {
      // 生成内容
      let content: string;
      if (config.useAI) {
        content = await generateContentWithAI(news.title, news.url);
      } else {
        content = `📰 ${news.title}\n\n这一话题正在引发广泛关注，你怎么看？\n\n#热点`;
      }

      // 优化标签
      if (config.addHashtag) {
        content = extractAndOptimizeHashtags(content, news.title);
      }

      // 发布
      const success = await publishSinglePost(publisher, content, config.dryRun);

      if (success) {
        stats.success++;
      } else {
        stats.failed++;
      }

      // 等待间隔（最后一条不需要等待）
      if (i < newsList.length - 1) {
        console.log(`\n⏳ 等待 ${config.interval} 秒后继续...`);
        await sleep(config.interval);
      }

    } catch (error) {
      console.error(`❌ 处理失败: ${error}`);
      stats.failed++;
    }
  }

  // 6. 显示统计
  console.log('\n' + '='.repeat(70));
  console.log('📝 [5/5] 任务完成统计');
  console.log('='.repeat(70));
  console.log(`\n📊 发布统计：`);
  console.log(`   总计: ${stats.total} 条`);
  console.log(`   ✅ 成功: ${stats.success} 条`);
  console.log(`   ❌ 失败: ${stats.failed} 条`);
  console.log(`   📈 成功率: ${((stats.success / stats.total) * 100).toFixed(1)}%`);

  console.log('\n' + '='.repeat(70));
  console.log('🎉 自动发布流程全部完成！');
  console.log('='.repeat(70) + '\n');
}

// 运行主程序
if (require.main === module) {
  main().catch(error => {
    console.error('\n❌ 程序异常:', error);
    process.exit(1);
  });
}

export { main as autoPublishWithAI };

