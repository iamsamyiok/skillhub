"use strict";
/**
 * 今日头条数据分析模块
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.TouTiaoAnalytics = void 0;
const config_1 = require("./config");
class TouTiaoAnalytics {
    constructor(auth) {
        this.auth = auth;
    }
    /**
     * 获取账户数据概览
     */
    async getAccountOverview() {
        try {
            const response = await this.auth.getAxiosInstance().get(config_1.TOUTIAO_URLS.analytics, {
                timeout: 15000,
            });
            if (response.status === 200 && response.data.message === 'success') {
                const data = response.data.data || {};
                console.log('获取账户概览成功');
                return {
                    success: true,
                    followersCount: data.followers_count || 0,
                    articlesCount: data.articles_count || 0,
                    totalReadCount: data.total_read_count || 0,
                    totalLikeCount: data.total_like_count || 0,
                };
            }
            return {
                success: false,
                message: response.data.message || '获取失败',
            };
        }
        catch (error) {
            console.error(`获取账户概览异常: ${error}`);
            return {
                success: false,
                message: `获取异常: ${error}`,
            };
        }
    }
    /**
     * 获取指定文章的统计数据
     */
    async getArticleStats(articleId) {
        try {
            const response = await this.auth.getAxiosInstance().get(config_1.TOUTIAO_URLS.articleStats, {
                params: { article_id: articleId },
                timeout: 15000,
            });
            if (response.status === 200 && response.data.message === 'success') {
                const data = response.data.data || {};
                console.log(`获取文章统计成功: ${articleId}`);
                return {
                    success: true,
                    articleId,
                    readCount: data.read_count || 0,
                    commentCount: data.comment_count || 0,
                    likeCount: data.like_count || 0,
                    shareCount: data.share_count || 0,
                };
            }
            return {
                success: false,
                message: response.data.message || '获取失败',
            };
        }
        catch (error) {
            console.error(`获取文章统计异常: ${error}`);
            return {
                success: false,
                message: `获取异常: ${error}`,
            };
        }
    }
    /**
     * 获取趋势分析数据
     */
    async getTrendingAnalysis(days = 7) {
        try {
            const response = await this.auth.getAxiosInstance().get(config_1.TOUTIAO_URLS.analytics, {
                params: { days, type: 'trending' },
                timeout: 15000,
            });
            if (response.status === 200 && response.data.message === 'success') {
                console.log(`获取 ${days} 天趋势分析成功`);
                return {
                    success: true,
                    data: response.data.data,
                };
            }
            return {
                success: false,
                message: response.data.message || '获取失败',
            };
        }
        catch (error) {
            console.error(`获取趋势分析异常: ${error}`);
            return {
                success: false,
                message: `获取异常: ${error}`,
            };
        }
    }
    /**
     * 生成报告
     */
    async generateReport(reportType = 'weekly') {
        try {
            let days = 7;
            if (reportType === 'daily')
                days = 1;
            else if (reportType === 'monthly')
                days = 30;
            const overview = await this.getAccountOverview();
            const trending = await this.getTrendingAnalysis(days);
            return {
                success: true,
                reportType,
                overview,
                trending,
                generatedAt: new Date().toISOString(),
            };
        }
        catch (error) {
            console.error(`生成报告异常: ${error}`);
            return {
                success: false,
                message: `生成异常: ${error}`,
            };
        }
    }
}
exports.TouTiaoAnalytics = TouTiaoAnalytics;
//# sourceMappingURL=analytics.js.map