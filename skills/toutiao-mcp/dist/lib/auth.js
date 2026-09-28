"use strict";
/**
 * 今日头条认证管理模块
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TouTiaoAuth = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const axios_1 = __importDefault(require("axios"));
const selenium_webdriver_1 = require("selenium-webdriver");
const chrome = __importStar(require("selenium-webdriver/chrome"));
const config_1 = require("./config");
class TouTiaoAuth {
    constructor(cookiesFile) {
        this.cookies = [];
        this.cookiesFile = cookiesFile || (0, config_1.getCookiesFilePath)();
        this.axiosInstance = axios_1.default.create({
            headers: { ...config_1.DEFAULT_HEADERS },
            timeout: 30000,
        });
        this.loadCookies();
    }
    /**
     * 从文件加载 Cookie
     */
    loadCookies() {
        try {
            if (fs.existsSync(this.cookiesFile)) {
                const data = fs.readFileSync(this.cookiesFile, 'utf-8');
                const cookiesData = JSON.parse(data);
                this.cookies = cookiesData.cookies || [];
                // 更新 axios 实例的 Cookie
                this.updateAxiosCookies();
                console.log(`已加载 ${this.cookies.length} 个 Cookie`);
            }
        }
        catch (error) {
            console.warn(`加载 Cookie 失败: ${error}`);
        }
    }
    /**
     * 保存 Cookie 到文件
     */
    saveCookies(cookies) {
        try {
            const dir = path.dirname(this.cookiesFile);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            const cookiesData = {
                cookies,
                timestamp: Date.now(),
            };
            fs.writeFileSync(this.cookiesFile, JSON.stringify(cookiesData, null, 2), 'utf-8');
            console.log(`已保存 ${cookies.length} 个 Cookie`);
        }
        catch (error) {
            console.error(`保存 Cookie 失败: ${error}`);
        }
    }
    /**
     * 更新 axios 实例的 Cookie
     */
    updateAxiosCookies() {
        const cookieString = this.cookies
            .map(cookie => `${cookie.name}=${cookie.value}`)
            .join('; ');
        if (cookieString) {
            this.axiosInstance.defaults.headers.common['Cookie'] = cookieString;
        }
    }
    /**
     * 设置 Chrome 浏览器驱动
     */
    async setupDriver() {
        const options = new chrome.Options();
        // 添加浏览器选项
        config_1.SELENIUM_CONFIG.chromeOptions.forEach(option => {
            options.addArguments(option);
        });
        // 设置用户代理
        options.addArguments(`--user-agent=${config_1.DEFAULT_HEADERS['User-Agent']}`);
        // 无头模式
        if (config_1.SELENIUM_CONFIG.headless) {
            options.addArguments('--headless');
        }
        const driver = await new selenium_webdriver_1.Builder()
            .forBrowser('chrome')
            .setChromeOptions(options)
            .build();
        // 设置超时
        await driver.manage().setTimeouts({
            implicit: config_1.SELENIUM_CONFIG.implicitWait,
        });
        console.log('ChromeDriver 初始化成功');
        return driver;
    }
    /**
     * 使用 Selenium 自动登录
     */
    async loginWithSelenium(username, password) {
        let driver = null;
        try {
            driver = await this.setupDriver();
            console.log('正在打开今日头条登录页面...');
            // 访问登录页面
            await driver.get(config_1.TOUTIAO_URLS.login);
            // 等待页面加载
            await driver.sleep(3000);
            console.log('页面加载完成，请手动进行登录操作');
            console.log('注意事项：');
            console.log('1. 今日头条通常使用手机号+验证码登录');
            console.log('2. 请手动输入手机号');
            console.log('3. 点击获取验证码');
            console.log('4. 输入收到的验证码');
            console.log('5. 点击登录按钮');
            console.log('6. 等待登录成功跳转');
            // 等待登录成功
            const waitTime = 300; // 5分钟
            console.log(`等待登录完成，最多等待${waitTime}秒...`);
            let success = false;
            for (let i = 0; i < waitTime; i++) {
                const currentUrl = await driver.getCurrentUrl();
                // 检查是否跳转到创作者中心或主页
                // 登录成功后可能跳转到以下任一页面：
                // 1. https://www.toutiao.com/?is_new_connect=0&is_new_user=0&wid=xxx (登录后的主页)
                // 2. https://mp.toutiao.com/profile_v4/ (创作者中心)
                // 3. https://creator.toutiao.com (创作者平台)
                // 4. https://mp.toutiao.com/dashboard (仪表盘)
                if (currentUrl.includes('www.toutiao.com/?is_new_connect') || // 登录后主页
                    currentUrl.includes('mp.toutiao.com/profile') ||
                    currentUrl.includes('creator.toutiao.com') ||
                    currentUrl.includes('mp.toutiao.com/dashboard')) {
                    success = true;
                    console.log(`检测到登录成功，跳转到: ${currentUrl}`);
                    break;
                }
                // 每30秒提示一次
                if (i % 30 === 0 && i > 0) {
                    console.log(`等待中... 已等待${i}秒，剩余${waitTime - i}秒`);
                }
                await driver.sleep(1000);
            }
            if (success) {
                // 获取所有 Cookie
                const seleniumCookies = await driver.manage().getCookies();
                // 转换 Cookie 格式
                const cookies = seleniumCookies.map(cookie => ({
                    name: cookie.name,
                    value: cookie.value,
                    domain: cookie.domain || '.toutiao.com',
                    path: cookie.path,
                    expires: typeof cookie.expiry === 'number' ? cookie.expiry : undefined,
                    httpOnly: cookie.httpOnly,
                    secure: cookie.secure,
                }));
                this.saveCookies(cookies);
                this.cookies = cookies;
                this.updateAxiosCookies();
                console.log('登录成功，已保存 Cookie');
                return true;
            }
            else {
                console.error('登录超时或失败');
                return false;
            }
        }
        catch (error) {
            console.error(`登录过程出错: ${error}`);
            return false;
        }
        finally {
            if (driver) {
                await driver.quit();
            }
        }
    }
    /**
     * 检查当前登录状态
     */
    async checkLoginStatus() {
        try {
            const response = await this.axiosInstance.get(config_1.TOUTIAO_URLS.homepage, {
                timeout: 10000,
            });
            if (response.status === 200) {
                const responseText = response.data.toString().toLowerCase();
                // 检查多个可能的登录标识
                const loginIndicators = [
                    'profile',
                    'creator',
                    'dashboard',
                    'publish',
                    'content',
                    '创作者',
                    '发布',
                    '我的',
                ];
                for (const indicator of loginIndicators) {
                    if (responseText.includes(indicator)) {
                        console.log(`登录状态验证成功 (检测到: ${indicator})`);
                        return true;
                    }
                }
                // 如果没有重定向到登录页面，也认为登录成功
                if (!responseText.includes('login') && !responseText.includes('auth')) {
                    console.log('登录状态验证成功 (未检测到登录页面)');
                    return true;
                }
            }
            console.warn(`登录状态验证失败 - 状态码: ${response.status}`);
            return false;
        }
        catch (error) {
            console.error(`检查登录状态失败: ${error}`);
            return false;
        }
    }
    /**
     * 获取当前登录用户信息
     */
    async getUserInfo() {
        try {
            const response = await this.axiosInstance.get(config_1.TOUTIAO_URLS.userInfo, {
                timeout: 10000,
            });
            if (response.status === 200) {
                // 根据实际API返回格式解析
                const userInfo = {
                    login_status: true,
                    user_id: undefined,
                    username: undefined,
                    nickname: undefined,
                    avatar: undefined,
                    followers_count: 0,
                    following_count: 0,
                };
                console.log('获取用户信息成功');
                return userInfo;
            }
            else {
                console.error(`获取用户信息失败，状态码: ${response.status}`);
                return null;
            }
        }
        catch (error) {
            console.error(`获取用户信息异常: ${error}`);
            return null;
        }
    }
    /**
     * 登出当前账户
     */
    logout() {
        try {
            // 清除内存中的 Cookie
            this.cookies = [];
            this.axiosInstance.defaults.headers.common['Cookie'] = '';
            // 删除本地 Cookie 文件
            if (fs.existsSync(this.cookiesFile)) {
                fs.unlinkSync(this.cookiesFile);
            }
            console.log('已清除登录信息');
            return true;
        }
        catch (error) {
            console.error(`登出失败: ${error}`);
            return false;
        }
    }
    /**
     * 获取 axios 实例（供其他模块使用）
     */
    getAxiosInstance() {
        return this.axiosInstance;
    }
    /**
     * 获取 cookies（供 Selenium 使用）
     */
    getCookies() {
        return this.cookies;
    }
}
exports.TouTiaoAuth = TouTiaoAuth;
//# sourceMappingURL=auth.js.map