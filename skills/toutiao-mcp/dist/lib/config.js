"use strict";
/**
 * 今日头条 MCP 服务器配置
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.MCP_CONFIG = exports.LOG_CONFIG = exports.CONTENT_CONFIG = exports.SELENIUM_CONFIG = exports.DEFAULT_HEADERS = exports.TOUTIAO_URLS = void 0;
exports.getCookiesFilePath = getCookiesFilePath;
exports.getDownloadFolderPath = getDownloadFolderPath;
const path = __importStar(require("path"));
// 今日头条相关 URL
exports.TOUTIAO_URLS = {
    login: 'https://mp.toutiao.com/auth/page/login',
    homepage: 'https://mp.toutiao.com/profile_v4/index',
    userInfo: 'https://mp.toutiao.com/profile_v4/user/info',
    // 发布相关
    publishArticle: 'https://mp.toutiao.com/profile_v4/graphic/publish',
    publishMicroPost: 'https://mp.toutiao.com/profile_v4/weitoutiao/publish?from=toutiao_pc',
    upload: 'https://mp.toutiao.com/upload_photo/v2/',
    // 内容管理
    articleList: 'https://mp.toutiao.com/profile_v4/graphic/articles',
    deleteArticle: 'https://mp.toutiao.com/profile_v4/graphic/delete',
    // 数据分析
    analytics: 'https://mp.toutiao.com/profile_v4/analysis/overview',
    articleStats: 'https://mp.toutiao.com/profile_v4/analysis/article',
};
// 默认 HTTP 请求头
exports.DEFAULT_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'Accept-Encoding': 'gzip, deflate, br',
    'Connection': 'keep-alive',
    'Referer': 'https://mp.toutiao.com/',
};
// Selenium 配置
exports.SELENIUM_CONFIG = {
    implicitWait: 10000, // 10 seconds
    explicitWait: 30000, // 30 seconds
    headless: false, // 是否使用无头模式
    chromeOptions: [
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled',
        '--disable-infobars',
        '--start-maximized',
    ],
};
// 内容发布配置
exports.CONTENT_CONFIG = {
    defaultCategory: '科技',
    maxImagesPerArticle: 20,
    maxImagesPerMicroPost: 9,
    autoCompressImages: true,
    maxImageSize: 1024 * 1024, // 1MB
    imageQuality: 85,
};
// Cookie 文件路径
function getCookiesFilePath() {
    return path.join(process.cwd(), 'toutiao_cookies.json');
}
// 下载文件夹路径
function getDownloadFolderPath(folderName = 'downloaded_images') {
    return path.join(process.cwd(), folderName);
}
// 日志配置
exports.LOG_CONFIG = {
    level: process.env.LOG_LEVEL || 'info',
    file: path.join(process.cwd(), 'toutiao_mcp.log'),
};
// MCP 服务器配置
exports.MCP_CONFIG = {
    name: 'toutiao-mcp-server',
    version: '1.0.0',
    description: '今日头条内容管理 MCP 服务器 - Node.js/TypeScript 实现',
};
//# sourceMappingURL=config.js.map