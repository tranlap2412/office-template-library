import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { TEST_DATABASE_URL } from "./env.js";

/**
 * Chuẩn bị CSDL test một lần cho cả bộ test: xóa schema cũ rồi áp dụng các file migration
 * (đúng SQL mà `prisma migrate deploy` sẽ chạy).
 */
export default async function setup() {
  const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
  try {
    await client.connect();
  } catch (err) {
    throw new Error(
      `Không kết nối được PostgreSQL test tại ${TEST_DATABASE_URL}.\n` +
        `Chạy: docker compose up -d postgres  (hoặc đặt TEST_DATABASE_URL)\n${(err as Error).message}`,
    );
  }
  try {
    await client.query("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;");
    const dir = path.resolve(import.meta.dirname, "../../prisma/migrations");
    for (const name of fs.readdirSync(dir).filter((n) => fs.statSync(path.join(dir, n)).isDirectory()).sort()) {
      await client.query(fs.readFileSync(path.join(dir, name, "migration.sql"), "utf8"));
    }
  } finally {
    await client.end();
  }
}
