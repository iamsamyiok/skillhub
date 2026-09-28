/**
 * 今日头条认证管理模块
 */
import { AxiosInstance } from 'axios';
import { Cookie, UserInfo } from '../types';
export declare class TouTiaoAuth {
    private cookiesFile;
    private axiosInstance;
    private cookies;
    constructor(cookiesFile?: string);
    /**
     * 从文件加载 Cookie
     */
    private loadCookies;
    /**
     * 保存 Cookie 到文件
     */
    private saveCookies;
    /**
     * 更新 axios 实例的 Cookie
     */
    private updateAxiosCookies;
    /**
     * 设置 Chrome 浏览器驱动
     */
    private setupDriver;
    /**
     * 使用 Selenium 自动登录
     */
    loginWithSelenium(username?: string, password?: string): Promise<boolean>;
    /**
     * 检查当前登录状态
     */
    checkLoginStatus(): Promise<boolean>;
    /**
     * 获取当前登录用户信息
     */
    getUserInfo(): Promise<UserInfo | null>;
    /**
     * 登出当前账户
     */
    logout(): boolean;
    /**
     * 获取 axios 实例（供其他模块使用）
     */
    getAxiosInstance(): AxiosInstance;
    /**
     * 获取 cookies（供 Selenium 使用）
     */
    getCookies(): Cookie[];
}
//# sourceMappingURL=auth.d.ts.map