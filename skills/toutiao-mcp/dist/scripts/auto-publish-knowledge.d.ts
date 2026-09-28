/**
 * 程序员知识分享自动发布脚本
 *
 * 功能流程：
 * 1. 展示知识主题清单（第一阶段：NestJS）
 * 2. 用户选择主题
 * 3. 使用 AI 生成高质量技术文章
 * 4. 自动发布到今日头条文章
 *
 * 使用方法：
 * npm run auto-publish-knowledge
 */
interface KnowledgeTopic {
    id: number;
    category: string;
    title: string;
    keywords: string[];
    difficulty: '入门' | '进阶' | '高级';
    estimatedWords: number;
    description: string;
}
declare const NESTJS_TOPICS: KnowledgeTopic[];
declare function main(): Promise<void>;
export { main as autoPublishKnowledge, NESTJS_TOPICS };
//# sourceMappingURL=auto-publish-knowledge.d.ts.map