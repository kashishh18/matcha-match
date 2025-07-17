import { Knex } from 'knex';
import { DatabaseTables } from '@/types';
declare const config: {
    [key: string]: Knex.Config;
};
export default config;
export declare const initializeDatabase: () => Promise<Knex<DatabaseTables>>;
export declare const checkDatabaseHealth: (db: Knex) => Promise<boolean>;
export declare const closeDatabaseConnection: (db: Knex) => Promise<void>;
