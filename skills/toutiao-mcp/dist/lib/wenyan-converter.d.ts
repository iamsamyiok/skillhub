/**
 * 文颜（Wenyan）Markdown 转换器
 * 使用 @wenyan-md/core 将 Markdown 转换为精美的 HTML 排版
 *
 * 文颜是一款多平台排版美化工具，支持多种主题和代码高亮风格
 */
/**
 * 文颜主题选项
 */
export type WenyanTheme = 'default' | 'orangeheart' | 'rainbow' | 'lapis' | 'pie' | 'maize' | 'purple' | 'phycat';
/**
 * 代码高亮主题选项
 */
export type WenyanHighlightTheme = 'atom-one-dark' | 'atom-one-light' | 'dracula' | 'github-dark' | 'github' | 'monokai' | 'solarized-dark' | 'solarized-light' | 'xcode';
/**
 * 文颜转换结果
 */
export interface WenyanResult {
    title: string;
    cover: string;
    content: string;
    description: string;
}
/**
 * 将 Markdown 内容转换为文颜风格的 HTML
 * @param content Markdown 内容
 * @param theme 主题名称，默认 'lapis'
 * @param highlightTheme 代码高亮主题，默认 'github'
 * @param isMacStyle 代码块是否使用 Mac 风格，默认 true
 * @returns 转换后的结果对象
 */
export declare function convertToWenyanHtml(content: string, theme?: WenyanTheme, highlightTheme?: WenyanHighlightTheme, isMacStyle?: boolean): Promise<WenyanResult>;
/**
 * 文颜转换器类（支持自定义配置）
 */
export declare class WenyanConverter {
    private theme;
    private highlightTheme;
    private isMacStyle;
    constructor(theme?: WenyanTheme, highlightTheme?: WenyanHighlightTheme, isMacStyle?: boolean);
    /**
     * 渲染 Markdown 为 HTML
     */
    render(content: string): Promise<WenyanResult>;
    /**
     * 设置主题
     */
    setTheme(theme: WenyanTheme): void;
    /**
     * 设置代码高亮主题
     */
    setHighlightTheme(highlightTheme: WenyanHighlightTheme): void;
    /**
     * 设置是否使用 Mac 风格代码块
     */
    setMacStyle(isMacStyle: boolean): void;
}
//# sourceMappingURL=wenyan-converter.d.ts.map