"use strict";
/**
 * 今日头条内容发布模块
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
exports.TouTiaoPublisher = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const selenium_webdriver_1 = require("selenium-webdriver");
const chrome = __importStar(require("selenium-webdriver/chrome"));
const sharp_1 = __importDefault(require("sharp"));
const config_1 = require("./config");
class TouTiaoPublisher {
    constructor(auth) {
        this.auth = auth;
    }
    /**
     * 压缩图片
     */
    async compressImage(imagePath, maxSize = config_1.CONTENT_CONFIG.maxImageSize) {
        try {
            const stats = fs.statSync(imagePath);
            if (stats.size <= maxSize) {
                return imagePath;
            }
            const quality = Math.max(20, Math.min(95, Math.floor((maxSize / stats.size) * 100)));
            const compressedPath = imagePath.replace(/\.(jpg|jpeg|png|webp)$/i, '.compressed.jpg');
            await (0, sharp_1.default)(imagePath)
                .jpeg({ quality, mozjpeg: true })
                .toFile(compressedPath);
            console.log(`图片已压缩: ${stats.size} -> ${fs.statSync(compressedPath).size}`);
            return compressedPath;
        }
        catch (error) {
            console.warn(`图片压缩失败: ${error}，使用原图片`);
            return imagePath;
        }
    }
    /**
     * 设置 Chrome 浏览器驱动
     */
    async setupDriver() {
        const options = new chrome.Options();
        config_1.SELENIUM_CONFIG.chromeOptions.forEach(option => {
            options.addArguments(option);
        });
        options.addArguments(`--user-agent=${config_1.DEFAULT_HEADERS['User-Agent']}`);
        if (config_1.SELENIUM_CONFIG.headless) {
            options.addArguments('--headless');
        }
        const driver = await new selenium_webdriver_1.Builder()
            .forBrowser('chrome')
            .setChromeOptions(options)
            .build();
        await driver.manage().setTimeouts({
            implicit: config_1.SELENIUM_CONFIG.implicitWait,
        });
        console.log('ChromeDriver 初始化成功');
        return driver;
    }
    /**
     * 将 Cookie 传递给浏览器
     */
    async transferCookiesToDriver(driver) {
        // 先访问今日头条域名，这样才能添加该域名的 Cookie
        await driver.get('https://mp.toutiao.com');
        await driver.sleep(1000);
        const cookies = this.auth.getCookies();
        console.log(`准备添加 ${cookies.length} 个 Cookie...`);
        let addedCount = 0;
        for (const cookie of cookies) {
            if (cookie.domain && cookie.domain.includes('.toutiao.com')) {
                try {
                    await driver.manage().addCookie({
                        name: cookie.name,
                        value: cookie.value,
                        domain: cookie.domain,
                        path: cookie.path,
                    });
                    addedCount++;
                }
                catch (error) {
                    console.warn(`添加 Cookie 失败 (${cookie.name}): ${error}`);
                }
            }
        }
        console.log(`已添加 ${addedCount} 个 Cookie`);
        // 重要：刷新页面让 Cookie 生效
        console.log('刷新页面以使 Cookie 生效...');
        await driver.navigate().refresh();
        await driver.sleep(2000);
        // 验证 Cookie 是否生效
        const currentUrl = await driver.getCurrentUrl();
        console.log(`Cookie 传递后的页面URL: ${currentUrl}`);
        if (currentUrl.includes('profile')) {
            console.log('✅ Cookie 已成功生效，已登录状态');
        }
        else {
            console.warn('⚠️ Cookie 可能未生效，请检查');
        }
    }
    /**
     * 发布文章到今日头条
     */
    async publishArticle(params) {
        let driver = null;
        try {
            console.log(`开始发布文章: ${params.title}`);
            driver = await this.setupDriver();
            await this.transferCookiesToDriver(driver);
            console.log('正在打开文章发布页面...');
            await driver.get('https://mp.toutiao.com/profile_v4/graphic/publish');
            await driver.sleep(1000);
            // 检查是否需要重新登录
            const currentUrl = await driver.getCurrentUrl();
            if (currentUrl.includes('login') || currentUrl.includes('auth')) {
                return {
                    success: false,
                    message: '需要重新登录，请先运行登录脚本',
                };
            }
            // 等待页面加载
            await driver.wait(selenium_webdriver_1.until.elementLocated(selenium_webdriver_1.By.tagName('textarea')), 20000);
            await driver.sleep(2000);
            // 输入标题
            console.log('正在输入标题...');
            const titleTextarea = await driver.findElement(selenium_webdriver_1.By.css("textarea[placeholder*='请输入文章标题']"));
            await driver.executeScript("arguments[0].scrollIntoView(true);", titleTextarea);
            await driver.sleep(1000);
            await driver.executeScript("arguments[0].click();", titleTextarea);
            await driver.sleep(1000);
            await titleTextarea.sendKeys(params.title);
            await driver.sleep(1500);
            // 输入正文
            console.log('正在输入正文内容...');
            const contentEditor = await driver.findElement(selenium_webdriver_1.By.css('.ProseMirror'));
            await contentEditor.click();
            await driver.sleep(2000);
            // 处理内容格式
            const paragraphs = params.content.split('\n');
            const formattedContent = paragraphs
                .map(para => (para.trim() ? `<p>${para.trim()}</p>` : '<p><br></p>'))
                .join('');
            await driver.executeScript("arguments[0].innerHTML = '';", contentEditor);
            await driver.sleep(1000);
            await driver.executeScript("arguments[0].innerHTML = arguments[1];", contentEditor, formattedContent);
            await driver.sleep(2000);
            // 触发内容变更事件
            await driver.executeScript(`
        var event = new Event('input', { bubbles: true });
        arguments[0].dispatchEvent(event);
      `, contentEditor);
            await driver.sleep(1500);
            // 上传封面图片（如果有）
            if (params.images && params.images.length > 0) {
                try {
                    console.log('正在上传封面图片...');
                    const imgPath = path.resolve(params.images[0]);
                    if (!fs.existsSync(imgPath)) {
                        console.error(`图片文件不存在: ${imgPath}`);
                    }
                    else {
                        await driver.sleep(2000);
                        const uploadButton = await driver.wait(selenium_webdriver_1.until.elementLocated(selenium_webdriver_1.By.css('div.article-cover-add')), 10000);
                        await driver.executeScript("arguments[0].scrollIntoView(true);", uploadButton);
                        await driver.sleep(1000);
                        await driver.executeScript("arguments[0].click();", uploadButton);
                        const uploadLocalButton = await driver.wait(selenium_webdriver_1.until.elementLocated(selenium_webdriver_1.By.css('div.btn-upload-handle.upload-handler')), 10000);
                        await driver.executeScript("arguments[0].scrollIntoView(true);", uploadLocalButton);
                        await driver.sleep(1000);
                        await driver.executeScript("arguments[0].click();", uploadLocalButton);
                        const fileInput = await driver.wait(selenium_webdriver_1.until.elementLocated(selenium_webdriver_1.By.css(".btn-upload-handle.upload-handler input[type='file']")), 10000);
                        await fileInput.sendKeys(imgPath);
                        await driver.wait(selenium_webdriver_1.until.elementLocated(selenium_webdriver_1.By.css("button[data-e2e='imageUploadConfirm-btn']")), 30000);
                        const confirmButton = await driver.findElement(selenium_webdriver_1.By.css("button[data-e2e='imageUploadConfirm-btn']"));
                        await driver.executeScript("arguments[0].scrollIntoView(true);", confirmButton);
                        await driver.sleep(1000);
                        await driver.executeScript("arguments[0].click();", confirmButton);
                        await driver.sleep(1500);
                        console.log('封面图片上传完成');
                    }
                }
                catch (error) {
                    console.warn(`封面图片上传失败: ${error}`);
                }
            }
            // 点击预览并发布
            console.log('正在点击预览并发布按钮...');
            await driver.sleep(30000); // 等待30秒让用户确认
            const previewBtn = await driver.wait(selenium_webdriver_1.until.elementLocated(selenium_webdriver_1.By.xpath("//button[contains(., '预览并发布')]")), 10000);
            await previewBtn.click();
            await driver.sleep(5000);
            console.log('文章已提交，请在浏览器中完成最后的发布确认');
            return {
                success: true,
                title: params.title,
                message: '文章已提交发布，请在浏览器中确认',
            };
        }
        catch (error) {
            console.error(`文章发布异常: ${error}`);
            return {
                success: false,
                title: params.title,
                message: `发布异常: ${error}`,
            };
        }
        finally {
            if (driver) {
                setTimeout(async () => {
                    try {
                        await driver?.quit();
                        console.log('浏览器已关闭');
                    }
                    catch (e) {
                        console.error(`关闭浏览器失败: ${e}`);
                    }
                }, 60000); // 60秒后关闭浏览器
            }
        }
    }
    /**
     * 发布微头条
     */
    async publishMicroPost(params) {
        let driver = null;
        try {
            console.log(`开始发布微头条: ${params.content.substring(0, 50)}...`);
            // 限制图片数量
            if (params.images && params.images.length > config_1.CONTENT_CONFIG.maxImagesPerMicroPost) {
                console.warn('微头条最多支持9张图片，将只使用前9张');
                params.images = params.images.slice(0, config_1.CONTENT_CONFIG.maxImagesPerMicroPost);
            }
            // 处理话题标签
            let microContent = params.content;
            if (params.topic && !params.topic.startsWith('#')) {
                microContent = `#${params.topic}# ${microContent}`;
            }
            driver = await this.setupDriver();
            await this.transferCookiesToDriver(driver);
            console.log('正在打开微头条发布页面...');
            await driver.get('https://mp.toutiao.com/profile_v4/weitoutiao/publish?from=toutiao_pc');
            // 等待页面加载
            console.log('等待页面加载...');
            await driver.sleep(5000);
            // 检查当前URL
            const currentUrl = await driver.getCurrentUrl();
            console.log(`当前页面URL: ${currentUrl}`);
            if (currentUrl.includes('login') || currentUrl.includes('auth')) {
                console.error('页面跳转到登录页面，Cookie可能已过期');
                return {
                    success: false,
                    message: '需要重新登录，Cookie可能已过期',
                };
            }
            // 查找编辑器
            console.log('开始查找编辑器元素...');
            let editor = null;
            const editorSelectors = [
                '.ProseMirror',
                'div.ProseMirror',
                "[contenteditable='true']",
                'textarea',
                "div[role='textbox']",
            ];
            for (const selector of editorSelectors) {
                try {
                    console.log(`尝试查找编辑器: ${selector}`);
                    editor = await driver.wait(selenium_webdriver_1.until.elementLocated(selenium_webdriver_1.By.css(selector)), 10000);
                    if (await editor.isDisplayed()) {
                        console.log(`✅ 找到编辑器元素: ${selector}`);
                        break;
                    }
                    editor = null;
                }
                catch (e) {
                    console.log(`未找到编辑器: ${selector}`);
                    continue;
                }
            }
            if (!editor) {
                // 获取页面源代码用于调试
                const pageSource = await driver.getPageSource();
                console.error('未找到编辑器元素');
                console.error('页面源代码片段:', pageSource.substring(0, 500));
                return {
                    success: false,
                    message: '编辑器加载失败，请检查页面是否正常加载。可能需要重新登录。',
                };
            }
            // 输入内容
            console.log('正在输入微头条内容...');
            const tagName = await editor.getTagName();
            console.log(`编辑器元素类型: ${tagName}`);
            if (tagName.toLowerCase() === 'textarea') {
                await editor.clear();
                await editor.sendKeys(microContent);
            }
            else {
                await editor.click();
                await driver.sleep(1000);
                const safeContent = microContent.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\n/g, '<br>');
                await driver.executeScript(`arguments[0].innerHTML = \`<p>${safeContent}</p>\``, editor);
                await driver.sleep(1000);
                await driver.executeScript(`
          var event = new Event('input', { bubbles: true });
          arguments[0].dispatchEvent(event);
        `, editor);
            }
            console.log('微头条内容输入完成');
            await driver.sleep(2000);
            // 点击发布按钮
            console.log('正在查找发布按钮...');
            try {
                let publishButton = null;
                // 尝试多种选择器来定位发布按钮
                const buttonSelectors = [
                    'button.publish-content', // 通过 class 定位
                    "button[class*='publish-content']", // 包含 publish-content 的按钮
                    "//button[contains(@class, 'publish-content')]", // XPath 通过 class
                    "//button[span[text()='发布']]", // XPath 查找包含 span 文字为"发布"的按钮
                    "//button[contains(., '发布')]", // XPath 查找包含"发布"文字的按钮（任意层级）
                ];
                for (const selector of buttonSelectors) {
                    try {
                        console.log(`尝试选择器: ${selector}`);
                        if (selector.startsWith('//')) {
                            // XPath 选择器
                            publishButton = await driver.wait(selenium_webdriver_1.until.elementLocated(selenium_webdriver_1.By.xpath(selector)), 5000);
                        }
                        else {
                            // CSS 选择器
                            publishButton = await driver.wait(selenium_webdriver_1.until.elementLocated(selenium_webdriver_1.By.css(selector)), 5000);
                        }
                        if (publishButton && await publishButton.isDisplayed()) {
                            console.log(`✅ 找到发布按钮: ${selector}`);
                            break;
                        }
                        publishButton = null;
                    }
                    catch (e) {
                        console.log(`未找到发布按钮: ${selector}`);
                        continue;
                    }
                }
                if (!publishButton) {
                    console.error('所有选择器都无法找到发布按钮');
                    return {
                        success: false,
                        message: '找不到发布按钮，页面结构可能已更改',
                    };
                }
                console.log('找到发布按钮，准备点击...');
                await publishButton.click();
                await driver.sleep(3000);
                console.log('✅ 微头条发布成功');
                return {
                    success: true,
                    message: '微头条发布成功',
                };
            }
            catch (error) {
                console.error(`点击发布按钮失败: ${error}`);
                return {
                    success: false,
                    message: `找不到发布按钮或点击失败: ${error}`,
                };
            }
        }
        catch (error) {
            console.error(`微头条发布异常: ${error}`);
            console.error('错误堆栈:', error.stack);
            return {
                success: false,
                message: `发布异常: ${error}`,
            };
        }
        finally {
            if (driver) {
                setTimeout(async () => {
                    try {
                        await driver?.quit();
                        console.log('浏览器已关闭');
                    }
                    catch (e) {
                        console.error(`关闭浏览器失败: ${e}`);
                    }
                }, 5000);
            }
        }
    }
    /**
     * 获取文章列表
     */
    async getArticleList(page = 1, pageSize = 20, status = 'all') {
        try {
            const response = await this.auth.getAxiosInstance().get(config_1.TOUTIAO_URLS.articleList, {
                params: { page, page_size: pageSize, status, from: 'pc' },
                timeout: 15000,
            });
            if (response.status === 200 && response.data.message === 'success') {
                const articles = response.data.data?.list || [];
                const total = response.data.data?.total || 0;
                console.log(`获取文章列表成功，共 ${total} 篇文章`);
                return {
                    success: true,
                    articles,
                    total,
                    page,
                    pageSize,
                };
            }
            return {
                success: false,
                message: response.data.message || '获取失败',
            };
        }
        catch (error) {
            console.error(`获取文章列表异常: ${error}`);
            return {
                success: false,
                message: `获取异常: ${error}`,
            };
        }
    }
    /**
     * 删除文章
     */
    async deleteArticle(articleId) {
        try {
            const response = await this.auth.getAxiosInstance().post(config_1.TOUTIAO_URLS.deleteArticle, { id: articleId, from: 'pc' }, { timeout: 15000 });
            if (response.status === 200 && response.data.message === 'success') {
                console.log(`文章删除成功: ${articleId}`);
                return {
                    success: true,
                    message: '文章删除成功',
                };
            }
            return {
                success: false,
                message: response.data.message || '删除失败',
            };
        }
        catch (error) {
            console.error(`文章删除异常: ${error}`);
            return {
                success: false,
                message: `删除异常: ${error}`,
            };
        }
    }
}
exports.TouTiaoPublisher = TouTiaoPublisher;
//# sourceMappingURL=publisher.js.map