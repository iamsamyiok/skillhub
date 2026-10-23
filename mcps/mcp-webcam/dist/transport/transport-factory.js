import { StdioTransport } from './stdio-transport.js';
import { StreamableHttpTransport } from './streamable-http-transport.js';
/**
 * Factory for creating transport instances
 */
export class TransportFactory {
    static create(type, serverFactory, app) {
        switch (type) {
            case 'stdio':
                return new StdioTransport(serverFactory);
            case 'streamable-http':
                if (!app) {
                    throw new Error('Express app is required for StreamableHTTP transport');
                }
                return new StreamableHttpTransport(serverFactory, app);
            default:
                throw new Error(`Unknown transport type: ${type}`);
        }
    }
}
