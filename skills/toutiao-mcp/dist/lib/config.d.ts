/**
 * 今日头条 MCP 服务器配置
 */
export declare const TOUTIAO_URLS: {
    login: string;
    homepage: string;
    userInfo: string;
    publishArticle: string;
    publishMicroPost: string;
    upload: string;
    articleList: string;
    deleteArticle: string;
    analytics: string;
    articleStats: string;
};
export declare const DEFAULT_HEADERS: {
    'User-Agent': string;
    Accept: string;
    'Accept-Language': string;
    'Accept-Encoding': string;
    Connection: string;
    Referer: string;
};
export declare const SELENIUM_CONFIG: {
    implicitWait: number;
    explicitWait: number;
    headless: boolean;
    chromeOptions: string[];
};
export declare const CONTENT_CONFIG: {
    defaultCategory: string;
    maxImagesPerArticle: number;
    maxImagesPerMicroPost: number;
    autoCompressImages: boolean;
    maxImageSize: number;
    imageQuality: number;
};
export declare function getCookiesFilePath(): string;
export declare function getDownloadFolderPath(folderName?: string): string;
export declare const LOG_CONFIG: {
    level: string;
    file: string;
};
export declare const MCP_CONFIG: {
    name: string;
    version: string;
    description: string;
};
//# sourceMappingURL=config.d.ts.map