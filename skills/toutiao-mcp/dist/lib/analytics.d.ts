/**
 * 今日头条数据分析模块
 */
import { TouTiaoAuth } from './auth';
import { AccountOverview, ArticleStats } from '../types';
export declare class TouTiaoAnalytics {
    private auth;
    constructor(auth: TouTiaoAuth);
    /**
     * 获取账户数据概览
     */
    getAccountOverview(): Promise<AccountOverview>;
    /**
     * 获取指定文章的统计数据
     */
    getArticleStats(articleId: string): Promise<ArticleStats>;
    /**
     * 获取趋势分析数据
     */
    getTrendingAnalysis(days?: number): Promise<any>;
    /**
     * 生成报告
     */
    generateReport(reportType?: string): Promise<any>;
}
//# sourceMappingURL=analytics.d.ts.map