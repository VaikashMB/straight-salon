// Minimal types for the parts of migrate-mongo we use (the package ships none).
declare module 'migrate-mongo' {
  import type { mongo } from 'mongoose';
  type Db = mongo.Db;
  type MongoClient = mongo.MongoClient;

  export interface MigrateMongoConfig {
    mongodb: { url: string; databaseName?: string; options?: Record<string, unknown> };
    migrationsDir: string;
    changelogCollectionName: string;
    lockCollectionName?: string;
    lockTtl?: number;
    migrationFileExtension?: string;
    useFileHash?: boolean;
    moduleSystem?: 'commonjs' | 'esm';
  }

  export const config: { set(config: MigrateMongoConfig): void };
  export const database: { connect(): Promise<{ db: Db; client: MongoClient }> };
  export function up(db: Db, client: MongoClient): Promise<string[]>;
  export function down(db: Db, client: MongoClient): Promise<string[]>;
  export function status(db: Db): Promise<{ fileName: string; appliedAt: string | Date }[]>;
}
