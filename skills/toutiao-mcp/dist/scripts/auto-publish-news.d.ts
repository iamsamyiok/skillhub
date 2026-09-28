/**
 * 自动化新闻发布脚本
 * 功能：
 * 1. 从 trends-hub 获取热点新闻
 * 2. 使用 AI 搜索并总结新闻内容
 * 3. 自动发布到今日头条微头条
 */
declare const NEWS_SOURCES: {
    weibo: string;
    zhihu: string;
    toutiao: string;
    douyin: string;
    baidu: string;
    netease: string;
    thepaper: string;
};
interface NewsItem {
    title: string;
    url?: string;
    hotValue?: string | number;
    rank?: number;
}
interface PublishConfig {
    source: keyof typeof NEWS_SOURCES;
    count: number;
    interval: number;
    aiModel?: string;
    includeHashtag: boolean;
    addEmoji: boolean;
}
/**
 * 从 trends-hub 获取热点新闻
 */
declare function fetchTrendingNews(source: string, limit?: number): Promise<NewsItem[]>;
/**
 * 使用 AI 搜索并总结新闻
 */
declare function summarizeNewsWithAI(newsTitle: string, aiModel?: string): Promise<string>;
/**
 * 主流程：自动化发布热点新闻
 */
declare function autoPublishNews(config: PublishConfig): Promise<void>;
export { autoPublishNews, fetchTrendingNews, summarizeNewsWithAI };
//# sourceMappingURL=auto-publish-news.d.ts.map