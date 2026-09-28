"use strict";
/**
 * 文颜（Wenyan）Markdown 转换器
 * 使用 @wenyan-md/core 将 Markdown 转换为精美的 HTML 排版
 *
 * 文颜是一款多平台排版美化工具，支持多种主题和代码高亮风格
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
exports.WenyanConverter = void 0;
exports.convertToWenyanHtml = convertToWenyanHtml;
/**
 * 将 Markdown 内容转换为文颜风格的 HTML
 * @param content Markdown 内容
 * @param theme 主题名称，默认 'lapis'
 * @param highlightTheme 代码高亮主题，默认 'github'
 * @param isMacStyle 代码块是否使用 Mac 风格，默认 true
 * @returns 转换后的结果对象
 */
async function convertToWenyanHtml(content, theme = 'lapis', highlightTheme = 'github', isMacStyle = true) {
    try {
        // 动态导入 ESM 模块
        const { getGzhContent } = await Promise.resolve().then(() => __importStar(require('@wenyan-md/core/wrapper')));
        const result = await getGzhContent(content, theme, highlightTheme, isMacStyle);
        return result;
    }
    catch (error) {
        console.error('❌ Markdown 转文颜 HTML 失败:', error);
        throw error;
    }
}
/**
 * 文颜转换器类（支持自定义配置）
 */
class WenyanConverter {
    constructor(theme = 'lapis', highlightTheme = 'github', isMacStyle = true) {
        this.theme = theme;
        this.highlightTheme = highlightTheme;
        this.isMacStyle = isMacStyle;
    }
    /**
     * 渲染 Markdown 为 HTML
     */
    async render(content) {
        return await convertToWenyanHtml(content, this.theme, this.highlightTheme, this.isMacStyle);
    }
    /**
     * 设置主题
     */
    setTheme(theme) {
        this.theme = theme;
    }
    /**
     * 设置代码高亮主题
     */
    setHighlightTheme(highlightTheme) {
        this.highlightTheme = highlightTheme;
    }
    /**
     * 设置是否使用 Mac 风格代码块
     */
    setMacStyle(isMacStyle) {
        this.isMacStyle = isMacStyle;
    }
}
exports.WenyanConverter = WenyanConverter;
//# sourceMappingURL=wenyan-converter.js.map