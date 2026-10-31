import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client.js";
import type { Logger } from "./lib/logger.js";

export type Db = PrismaClient;

export function createDb(databaseUrl: string): Db {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
}

/** Chờ PostgreSQL sẵn sàng (container DB cần vài giây để khởi động). */
export async function waitForDatabase(db: Db, retries: number, logger: Logger) {
  for (let attempt = 1; ; attempt++) {
    try {
      await db.$queryRaw`SELECT 1`;
      return;
    } catch (err) {
      if (attempt >= retries) throw err;
      logger.warn({ attempt, retries, message: (err as Error).message }, "Database not ready");
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}
