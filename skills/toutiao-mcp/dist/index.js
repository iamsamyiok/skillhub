#!/usr/bin/env node
"use strict";
/**
 * 今日头条 MCP 服务器主入口
 */
Object.defineProperty(exports, "__esModule", { value: true });
const index_js_1 = require("@modelcontextprotocol/sdk/server/index.js");
const stdio_js_1 = require("@modelcontextprotocol/sdk/server/stdio.js");
const types_js_1 = require("@modelcontextprotocol/sdk/types.js");
const auth_js_1 = require("./lib/auth.js");
const publisher_js_1 = require("./lib/publisher.js");
const analytics_js_1 = require("./lib/analytics.js");
const config_js_1 = require("./lib/config.js");
// 初始化服务实例
let authManager = null;
let publisher = null;
let analytics = null;
function initializeServices() {
    try {
        authManager = new auth_js_1.TouTiaoAuth();
        publisher = new publisher_js_1.TouTiaoPublisher(authManager);
        analytics = new analytics_js_1.TouTiaoAnalytics(authManager);
        console.log('✅ 服务实例初始化成功');
    }
    catch (error) {
        console.error('❌ 服务实例初始化失败:', error);
        throw error;
    }
}
// 创建 MCP 服务器
const server = new index_js_1.Server({
    name: config_js_1.MCP_CONFIG.name,
    version: config_js_1.MCP_CONFIG.version,
}, {
    capabilities: {
        tools: {},
    },
});
// 定义所有工具
const tools = [
    {
        name: 'login_with_credentials',
        description: '使用用户名密码登录今日头条（通过Selenium自动化）',
        inputSchema: {
            type: 'object',
            properties: {
                username: {
                    type: 'string',
                    description: '用户名（手机号/邮箱）- 可选，如果不提供将需要手动登录',
                },
                password: {
                    type: 'string',
                    description: '密码 - 可选',
                },
            },
        },
    },
    {
        name: 'check_login_status',
        description: '检查当前登录状态',
        inputSchema: {
            type: 'object',
            properties: {},
        },
    },
    {
        name: 'publish_article',
        description: '发布图文文章到今日头条',
        inputSchema: {
            type: 'object',
            properties: {
                title: { type: 'string', description: '文章标题 (2-30个字)' },
                content: { type: 'string', description: '文章内容' },
                images: {
                    type: 'array',
                    items: { type: 'string' },
                    description: '图片路径列表（可选）',
                },
                tags: {
                    type: 'array',
                    items: { type: 'string' },
                    description: '标签列表（可选）',
                },
                category: { type: 'string', description: '分类（可选）' },
            },
            required: ['title', 'content'],
        },
    },
    {
        name: 'publish_micro_post',
        description: '发布微头条',
        inputSchema: {
            type: 'object',
            properties: {
                content: { type: 'string', description: '微头条内容' },
                images: {
                    type: 'array',
                    items: { type: 'string' },
                    description: '配图路径列表（最多9张，可选）',
                },
                topic: { type: 'string', description: '话题标签（可选）' },
            },
            required: ['content'],
        },
    },
    {
        name: 'get_article_list',
        description: '获取已发布文章列表',
        inputSchema: {
            type: 'object',
            properties: {
                page: { type: 'number', description: '页码，默认1' },
                pageSize: { type: 'number', description: '每页数量，默认20' },
                status: { type: 'string', description: '文章状态 (all/published/draft/review)' },
            },
        },
    },
    {
        name: 'delete_article',
        description: '删除指定文章',
        inputSchema: {
            type: 'object',
            properties: {
                articleId: { type: 'string', description: '文章ID' },
            },
            required: ['articleId'],
        },
    },
    {
        name: 'get_account_overview',
        description: '获取账户数据概览',
        inputSchema: {
            type: 'object',
            properties: {},
        },
    },
    {
        name: 'get_article_stats',
        description: '获取指定文章的统计数据',
        inputSchema: {
            type: 'object',
            properties: {
                articleId: { type: 'string', description: '文章ID' },
            },
            required: ['articleId'],
        },
    },
    {
        name: 'generate_report',
        description: '生成数据分析报告',
        inputSchema: {
            type: 'object',
            properties: {
                reportType: {
                    type: 'string',
                    description: '报告类型 (daily/weekly/monthly)，默认weekly',
                },
            },
        },
    },
];
// 处理工具列表请求
server.setRequestHandler(types_js_1.ListToolsRequestSchema, async () => {
    return { tools };
});
// 处理工具调用请求
server.setRequestHandler(types_js_1.CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
        if (!authManager || !publisher || !analytics) {
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({ success: false, message: '服务未初始化' }),
                    },
                ],
            };
        }
        // 类型安全的参数访问
        const getArg = (key) => args?.[key];
        let result;
        switch (name) {
            case 'login_with_credentials':
                result = await authManager.loginWithSelenium(getArg('username'), getArg('password'));
                result = {
                    success: result,
                    message: result ? '登录成功' : '登录失败',
                    login_status: result ? await authManager.checkLoginStatus() : false,
                };
                break;
            case 'check_login_status':
                const isLoggedIn = await authManager.checkLoginStatus();
                const userInfo = isLoggedIn ? await authManager.getUserInfo() : null;
                result = {
                    success: true,
                    is_logged_in: isLoggedIn,
                    user_info: userInfo,
                };
                break;
            case 'publish_article':
                if (!(await authManager.checkLoginStatus())) {
                    result = { success: false, message: '请先登录' };
                }
                else {
                    result = await publisher.publishArticle({
                        title: String(getArg('title')),
                        content: String(getArg('content')),
                        images: getArg('images'),
                        tags: getArg('tags'),
                        category: getArg('category'),
                        original: getArg('original') !== false,
                    });
                }
                break;
            case 'publish_micro_post':
                if (!(await authManager.checkLoginStatus())) {
                    result = { success: false, message: '请先登录' };
                }
                else {
                    result = await publisher.publishMicroPost({
                        content: String(getArg('content')),
                        images: getArg('images'),
                        topic: getArg('topic'),
                    });
                }
                break;
            case 'get_article_list':
                if (!(await authManager.checkLoginStatus())) {
                    result = { success: false, message: '请先登录' };
                }
                else {
                    result = await publisher.getArticleList(Number(getArg('page')) || 1, Number(getArg('pageSize')) || 20, String(getArg('status') || 'all'));
                }
                break;
            case 'delete_article':
                if (!(await authManager.checkLoginStatus())) {
                    result = { success: false, message: '请先登录' };
                }
                else {
                    result = await publisher.deleteArticle(String(getArg('articleId')));
                }
                break;
            case 'get_account_overview':
                if (!(await authManager.checkLoginStatus())) {
                    result = { success: false, message: '请先登录' };
                }
                else {
                    result = await analytics.getAccountOverview();
                }
                break;
            case 'get_article_stats':
                if (!(await authManager.checkLoginStatus())) {
                    result = { success: false, message: '请先登录' };
                }
                else {
                    result = await analytics.getArticleStats(String(getArg('articleId')));
                }
                break;
            case 'generate_report':
                if (!(await authManager.checkLoginStatus())) {
                    result = { success: false, message: '请先登录' };
                }
                else {
                    result = await analytics.generateReport(String(getArg('reportType') || 'weekly'));
                }
                break;
            default:
                result = { success: false, message: `未知的工具: ${name}` };
        }
        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify(result, null, 2),
                },
            ],
        };
    }
    catch (error) {
        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify({
                        success: false,
                        message: `执行异常: ${error}`,
                    }),
                },
            ],
            isError: true,
        };
    }
});
// 启动服务器
async function main() {
    console.log('🚀 正在启动今日头条 MCP 服务器...');
    // 初始化服务
    initializeServices();
    console.log('📋 可用功能:');
    console.log('  - 用户认证: login_with_credentials, check_login_status');
    console.log('  - 内容发布: publish_article, publish_micro_post');
    console.log('  - 内容管理: get_article_list, delete_article');
    console.log('  - 数据分析: get_account_overview, get_article_stats');
    console.log('  - 报告生成: generate_report');
    const transport = new stdio_js_1.StdioServerTransport();
    await server.connect(transport);
    console.log('✅ 今日头条 MCP 服务器已启动');
}
main().catch((error) => {
    console.error('❌ 服务器启动失败:', error);
    process.exit(1);
});
//# sourceMappingURL=index.js.map