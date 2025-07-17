declare class MatchaMatchServer {
    private app;
    private server;
    private io;
    private db;
    private redis;
    private port;
    private searchService;
    private recommendationService;
    private scraperService;
    private connectedUsers;
    private productViewers;
    constructor();
    initialize(): Promise<void>;
    private initializeRedis;
    private initializeServices;
    private setupExpressApp;
    private setupWebSocketHandlers;
    private setupBackgroundJobs;
    private setupErrorHandling;
    broadcastStockUpdate(productId: string, stockData: any): void;
    broadcastPriceChange(productId: string, priceData: any): void;
    start(): Promise<void>;
    shutdown(): Promise<void>;
}
declare const server: MatchaMatchServer;
export default server;
