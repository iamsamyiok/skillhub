#!/usr/bin/env tsx
"use strict";
/**
 * 今日头条发布测试脚本
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
const readline = __importStar(require("readline"));
const auth_1 = require("../lib/auth");
const publisher_1 = require("../lib/publisher");
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
});
function question(prompt) {
    return new Promise((resolve) => {
        rl.question(prompt, (answer) => {
            resolve(answer.trim());
        });
    });
}
async function main() {
    console.log('='.repeat(60));
    console.log('今日头条内容发布工具');
    console.log('='.repeat(60));
    console.log();
    const auth = new auth_1.TouTiaoAuth();
    const publisher = new publisher_1.TouTiaoPublisher(auth);
    // 检查登录状态
    console.log('正在检查登录状态...');
    const isLoggedIn = await auth.checkLoginStatus();
    if (!isLoggedIn) {
        console.log('❌ 未登录或登录已过期');
        console.log('请先运行登录脚本: npm run login');
        process.exit(1);
    }
    console.log('✅ 已登录');
    console.log();
    // 选择发布类型
    console.log('请选择发布类型:');
    console.log('  1. 发布微头条（快速）');
    console.log('  2. 发布图文文章');
    console.log('  0. 退出');
    console.log();
    const choice = await question('请选择 (0-2): ');
    if (choice === '0') {
        console.log('已退出');
        rl.close();
        process.exit(0);
    }
    if (choice === '1') {
        // 发布微头条
        console.log();
        console.log('--- 发布微头条 ---');
        console.log('请输入微头条内容 (输入 END 结束):');
        console.log('-'.repeat(60));
        let content = '';
        let line = '';
        while ((line = await question('')) !== 'END') {
            content += line + '\n';
        }
        if (!content.trim()) {
            console.log('❌ 内容不能为空');
            rl.close();
            process.exit(1);
        }
        console.log();
        const confirm = await question('确认发布？(y/n): ');
        if (confirm.toLowerCase() !== 'y') {
            console.log('已取消');
            rl.close();
            process.exit(0);
        }
        console.log();
        console.log('正在发布微头条...');
        const result = await publisher.publishMicroPost({
            content: content.trim(),
        });
        console.log();
        if (result.success) {
            console.log('✅ 发布成功！');
            console.log(result.message);
        }
        else {
            console.log('❌ 发布失败');
            console.log(result.message);
        }
    }
    else if (choice === '2') {
        // 发布图文文章
        console.log();
        console.log('--- 发布图文文章 ---');
        const title = await question('文章标题 (2-30个字): ');
        if (!title || title.length < 2 || title.length > 30) {
            console.log('❌ 标题长度必须在2-30个字之间');
            rl.close();
            process.exit(1);
        }
        console.log();
        console.log('文章内容 (输入 END 结束):');
        console.log('-'.repeat(60));
        let content = '';
        let line = '';
        while ((line = await question('')) !== 'END') {
            content += line + '\n';
        }
        if (!content.trim()) {
            console.log('❌ 内容不能为空');
            rl.close();
            process.exit(1);
        }
        console.log();
        const imagePath = await question('封面图片路径 (可选，直接回车跳过): ');
        console.log();
        const confirm = await question('确认发布？(y/n): ');
        if (confirm.toLowerCase() !== 'y') {
            console.log('已取消');
            rl.close();
            process.exit(0);
        }
        console.log();
        console.log('正在发布文章...');
        const result = await publisher.publishArticle({
            title: title.trim(),
            content: content.trim(),
            images: imagePath ? [imagePath] : undefined,
        });
        console.log();
        if (result.success) {
            console.log('✅ 发布成功！');
            console.log(`标题: ${result.title}`);
            console.log(result.message);
        }
        else {
            console.log('❌ 发布失败');
            console.log(result.message);
        }
    }
    else {
        console.log('无效的选择');
    }
    rl.close();
}
main().catch((error) => {
    console.error('发生错误:', error);
    rl.close();
    process.exit(1);
});
//# sourceMappingURL=test-publish.js.map