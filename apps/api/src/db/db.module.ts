import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export const DB = Symbol("DB");

@Module({
  providers: [
    {
      provide: DB,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const connectionString =
          config.get<string>("DATABASE_URL") ?? "postgres://postgres:postgres@localhost:5432/gen_image_studio";
        const pool = new Pool({ connectionString });
        return drizzle(pool, { schema });
      }
    }
  ],
  exports: [DB]
})
export class DbModule {}

