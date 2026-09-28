/**
 * 今日头条内容发布模块
 */
import { TouTiaoAuth } from './auth';
import { PublishArticleParams, PublishMicroPostParams, PublishResult, ArticleListResult } from '../types';
export declare class TouTiaoPublisher {
    private auth;
    constructor(auth: TouTiaoAuth);
    /**
     * 压缩图片
     */
    private compressImage;
    /**
     * 设置 Chrome 浏览器驱动
     */
    private setupDriver;
    /**
     * 将 Cookie 传递给浏览器
     */
    private transferCookiesToDriver;
    /**
     * 发布文章到今日头条
     */
    publishArticle(params: PublishArticleParams): Promise<PublishResult>;
    /**
     * 发布微头条
     */
    publishMicroPost(params: PublishMicroPostParams): Promise<PublishResult>;
    /**
     * 获取文章列表
     */
    getArticleList(page?: number, pageSize?: number, status?: string): Promise<ArticleListResult>;
    /**
     * 删除文章
     */
    deleteArticle(articleId: string): Promise<PublishResult>;
}
//# sourceMappingURL=publisher.d.ts.map