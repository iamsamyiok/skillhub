import { Logger } from '../utils/logger.js';
/**
 * Base class for all transport implementations
 */
export class BaseTransport {
    serverFactory;
    app;
    constructor(serverFactory, app) {
        this.serverFactory = serverFactory;
        this.app = app;
    }
    /**
     * Get all active sessions with their metadata
     * Returns an array of session metadata for connection dashboard
     */
    getSessions() {
        return [];
    }
}
/**
 * Base class for stateful transport implementations that maintain session state
 * Provides common functionality for session management, stale connection detection, and client info tracking
 */
export class StatefulTransport extends BaseTransport {
    sessions = new Map();
    isShuttingDown = false;
    staleCheckInterval;
    pingInterval;
    pingsInFlight = new Set();
    // Configuration from environment variables with defaults
    STALE_CHECK_INTERVAL = parseInt(process.env.MCP_CLIENT_CONNECTION_CHECK || '20000', 10);
    STALE_TIMEOUT = parseInt(process.env.MCP_CLIENT_CONNECTION_TIMEOUT || '50000', 10);
    HEARTBEAT_INTERVAL = parseInt(process.env.MCP_CLIENT_HEARTBEAT_INTERVAL || '30000', 10);
    PING_ENABLED = process.env.MCP_PING_ENABLED !== 'false';
    PING_INTERVAL = parseInt(process.env.MCP_PING_INTERVAL || '30000', 10);
    PING_FAILURE_THRESHOLD = parseInt(process.env.MCP_PING_FAILURE_THRESHOLD || '1', 10);
    /**
     * Update the last activity timestamp for a session
     */
    updateSessionActivity(sessionId) {
        const session = this.sessions.get(sessionId);
        if (session) {
            session.metadata.lastActivity = new Date();
        }
    }
    /**
     * Check if a session is distressed (has excessive ping failures)
     */
    isSessionDistressed(session) {
        return (session.metadata.pingFailures || 0) >= this.PING_FAILURE_THRESHOLD;
    }
    /**
     * Create a standardized client info capture callback for a session
     */
    createClientInfoCapture(sessionId) {
        return () => {
            const session = this.sessions.get(sessionId);
            if (session) {
                const clientInfo = session.server.server.getClientVersion();
                const clientCapabilities = session.server.server.getClientCapabilities();
                if (clientInfo) {
                    session.metadata.clientInfo = clientInfo;
                }
                if (clientCapabilities) {
                    session.metadata.capabilities = {
                        sampling: !!clientCapabilities.sampling,
                        roots: !!clientCapabilities.roots,
                    };
                }
                Logger.debug(`Client Initialization Request for session ${sessionId}:`, {
                    clientInfo: session.metadata.clientInfo,
                    capabilities: session.metadata.capabilities,
                });
            }
        };
    }
    /**
     * Send a fire-and-forget ping to a single session
     * Success updates lastActivity, failures increment failure count
     */
    pingSingleSession(sessionId) {
        const session = this.sessions.get(sessionId);
        if (!session)
            return;
        // Skip if ping already in progress for this session
        if (this.pingsInFlight.has(sessionId)) {
            return;
        }
        // Mark ping as in-flight and update last ping attempt
        this.pingsInFlight.add(sessionId);
        session.metadata.lastPingAttempt = new Date();
        // Fire ping and handle result asynchronously
        session.server.server
            .ping()
            .then(() => {
            // SUCCESS: Update lastActivity timestamp and reset ping failures
            // This prevents the stale checker from removing this session
            this.updateSessionActivity(sessionId);
            session.metadata.pingFailures = 0;
            Logger.debug(`Ping succeeded for session ${sessionId}`);
        })
            .catch((error) => {
            // FAILURE: Increment ping failure count
            session.metadata.pingFailures = (session.metadata.pingFailures || 0) + 1;
            const errorMessage = error instanceof Error ? error.message : String(error);
            Logger.warn(`Ping failed for session ${sessionId}:`, errorMessage, `(failures: ${session.metadata.pingFailures}`);
        })
            .finally(() => {
            // Always remove from tracking set
            this.pingsInFlight.delete(sessionId);
        });
    }
    /**
     * Start the ping keep-alive interval
     */
    startPingKeepAlive() {
        if (!this.PING_ENABLED) {
            Logger.info('Ping keep-alive disabled');
            return;
        }
        this.pingInterval = setInterval(() => {
            if (this.isShuttingDown)
                return;
            // Ping all sessions that don't have an active ping
            for (const sessionId of this.sessions.keys()) {
                this.pingSingleSession(sessionId);
            }
        }, this.PING_INTERVAL);
        Logger.info(`Started ping keep-alive with interval ${this.PING_INTERVAL}ms`);
    }
    /**
     * Stop the ping keep-alive interval
     */
    stopPingKeepAlive() {
        if (this.pingInterval) {
            clearInterval(this.pingInterval);
            this.pingInterval = undefined;
            // Clear any in-flight pings
            this.pingsInFlight.clear();
            Logger.info('Stopped ping keep-alive');
        }
    }
    /**
     * Start the stale connection check interval
     */
    startStaleConnectionCheck() {
        this.staleCheckInterval = setInterval(() => {
            if (this.isShuttingDown)
                return;
            const now = Date.now();
            const staleSessionIds = [];
            // Find stale sessions
            for (const [sessionId, session] of this.sessions) {
                const timeSinceActivity = now - session.metadata.lastActivity.getTime();
                if (timeSinceActivity > this.STALE_TIMEOUT) {
                    staleSessionIds.push(sessionId);
                }
            }
            // Remove stale sessions
            for (const sessionId of staleSessionIds) {
                const session = this.sessions.get(sessionId);
                if (session) {
                    Logger.warn(`Removing stale session ${sessionId} (inactive for ${Math.round((now - session.metadata.lastActivity.getTime()) / 1000)}s)`);
                    void this.removeStaleSession(sessionId);
                }
            }
        }, this.STALE_CHECK_INTERVAL);
        Logger.info(`Started stale connection checker with ${this.STALE_CHECK_INTERVAL}ms interval, ${this.STALE_TIMEOUT}ms timeout`);
    }
    /**
     * Mark transport as shutting down
     */
    shutdown() {
        this.isShuttingDown = true;
    }
    /**
     * Get the number of active connections
     */
    getActiveConnectionCount() {
        return this.sessions.size;
    }
    /**
     * Check if server is accepting new connections
     */
    isAcceptingConnections() {
        return !this.isShuttingDown;
    }
    /**
     * Stop the stale connection check interval during cleanup
     */
    stopStaleConnectionCheck() {
        if (this.staleCheckInterval) {
            clearInterval(this.staleCheckInterval);
            this.staleCheckInterval = undefined;
        }
        this.stopPingKeepAlive();
    }
    /**
     * Get all active sessions with their metadata
     */
    getSessions() {
        return Array.from(this.sessions.values()).map((session) => session.metadata);
    }
    /**
     * Start heartbeat monitoring for a session with SSE response
     * Automatically detects stale connections and cleans them up
     */
    startHeartbeat(sessionId, response) {
        const session = this.sessions.get(sessionId);
        if (!session)
            return;
        // Clear any existing heartbeat
        this.stopHeartbeat(sessionId);
        session.heartbeatInterval = setInterval(() => {
            if (response.destroyed || response.writableEnded) {
                Logger.warn(`Detected stale connection via heartbeat for session ${sessionId}`);
                void this.removeStaleSession(sessionId);
            }
        }, this.HEARTBEAT_INTERVAL);
    }
    /**
     * Stop heartbeat monitoring for a session
     */
    stopHeartbeat(sessionId) {
        const session = this.sessions.get(sessionId);
        if (session?.heartbeatInterval) {
            clearInterval(session.heartbeatInterval);
            session.heartbeatInterval = undefined;
        }
    }
    /**
     * Set up standard SSE connection event handlers
     */
    setupSseEventHandlers(sessionId, response) {
        response.on('close', () => {
            Logger.info(`SSE connection closed by client for session ${sessionId}`);
            void this.removeStaleSession(sessionId);
        });
        response.on('error', (...args) => {
            const error = args[0];
            Logger.error(`SSE connection error for session ${sessionId}:`, error);
            void this.removeStaleSession(sessionId);
        });
    }
    /**
     * Standard session cleanup implementation
     * Handles stopping heartbeat, closing transport/server
     */
    async cleanupSession(sessionId) {
        try {
            const session = this.sessions.get(sessionId);
            if (!session)
                return;
            Logger.debug(`Cleaning up session ${sessionId}`);
            // Remove from map FIRST to prevent any re-entry
            this.sessions.delete(sessionId);
            // Clear heartbeat interval
            this.stopHeartbeat(sessionId);
            // Clear the onclose handler to prevent circular calls
            const transport = session.transport;
            if (transport && typeof transport.onclose !== 'undefined') {
                transport.onclose = undefined;
            }
            // Close transport
            try {
                await session.transport.close();
            }
            catch (error) {
                Logger.error(`Error closing transport for session ${sessionId}:`, error);
            }
            // Close server
            try {
                await session.server.close();
            }
            catch (error) {
                Logger.error(`Error closing server for session ${sessionId}:`, error);
            }
            Logger.debug(`Session ${sessionId} cleaned up`);
        }
        catch (error) {
            Logger.error(`Error during session cleanup for ${sessionId}:`, error);
        }
    }
    /**
     * Clean up all sessions in parallel
     */
    async cleanupAllSessions() {
        const sessionIds = Array.from(this.sessions.keys());
        const cleanupPromises = sessionIds.map((sessionId) => this.cleanupSession(sessionId).catch((error) => {
            Logger.error(`Error during session cleanup for ${sessionId}:`, error);
        }));
        await Promise.allSettled(cleanupPromises);
        this.sessions.clear();
    }
    /**
     * Set up standard server configuration for a session
     * Configures client info capture and error tracking
     */
    setupServerForSession(server, sessionId) {
        // Set up client info capture
        server.server.oninitialized = this.createClientInfoCapture(sessionId);
        // Set up error tracking for server errors
        server.server.onerror = (error) => {
            Logger.error(`Server error for session ${sessionId}:`, error);
        };
    }
}
