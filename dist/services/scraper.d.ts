import { Knex } from 'knex';
export declare class MatchaWebScraper {
    private db;
    private logger;
    private httpClient;
    private rateLimiter;
    private providers;
    constructor(database: Knex);
    scrapeAllProviders(): Promise<void>;
    private scrapeProvider;
    private parseNamiMatcha;
    private parseIppodoTea;
    private parseMizubaTea;
    private parseJadeLeafMatcha;
    private parseEncha;
    private parseMarukyuKoyamaen;
    private parseDoMatcha;
    private parseNaokiMatcha;
    private parseKettl;
    private parseMatchaKari;
    private parseGenericShopify;
    private parseGenericCustom;
    private parsePrice;
    private parseStockCount;
    private parseGrade;
    private parseOrigin;
    private parseFlavorProfile;
    private parseWeight;
    private inferGrade;
    private inferOrigin;
    private upsertProvider;
    private saveProduct;
    private updateProviderStats;
    private sleep;
    scrapeSpecificProvider(providerName: string): Promise<void>;
    getScrapingStats(): Promise<any>;
    shouldScrape(lastScraped: Date | null, intervalHours?: number): boolean;
    monitorStockChanges(): Promise<void>;
    cleanupOldData(daysToKeep?: number): Promise<void>;
    healthCheck(): Promise<{
        status: string;
        details: any;
    }>;
}
export default MatchaWebScraper;
