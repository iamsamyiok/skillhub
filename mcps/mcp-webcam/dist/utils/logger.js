/**
 * Logger utility with timestamp formatting for server-side logging
 * All logs go to stderr to ensure compatibility with MCP communication
 */
export class Logger {
    static formatTimestamp() {
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        const seconds = String(now.getSeconds()).padStart(2, '0');
        const milliseconds = String(now.getMilliseconds()).padStart(3, '0');
        return `[${year}-${month}-${day} ${hours}:${minutes}:${seconds}.${milliseconds}]`;
    }
    static log(...args) {
        const timestamp = this.formatTimestamp();
        console.error(timestamp, ...args);
    }
    static error(...args) {
        const timestamp = this.formatTimestamp();
        console.error(timestamp, '[ERROR]', ...args);
    }
    static warn(...args) {
        const timestamp = this.formatTimestamp();
        console.error(timestamp, '[WARN]', ...args);
    }
    static info(...args) {
        const timestamp = this.formatTimestamp();
        console.error(timestamp, '[INFO]', ...args);
    }
    static debug(...args) {
        const timestamp = this.formatTimestamp();
        console.error(timestamp, '[DEBUG]', ...args);
    }
}
