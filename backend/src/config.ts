import path from "node:path";
import { z } from "zod";

const bool = z
  .enum(["true", "false", "1", "0"])
  .default("false")
  .transform((v) => v === "true" || v === "1");

const schema = z
  .object({
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    PORT: z.coerce.number().int().positive().default(5080),
    DATABASE_URL: z.string().url(),
    DB_STARTUP_RETRIES: z.coerce.number().int().min(1).default(20),

    TEMPLATES_ROOT: z.string().default("../templates"),
    DOCUMENTS_ROOT: z.string().default("data/documents"),

    PREVIEWS_ENABLED: bool,
    SOFFICE_PATH: z.string().default("soffice"),
    PDFTOPPM_PATH: z.string().default("pdftoppm"),
    PREVIEW_MAX_PAGES: z.coerce.number().int().positive().default(12),
    PREVIEW_WIDTH: z.coerce.number().int().positive().default(960),
    PREVIEW_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(120),

    ADMIN_API_KEY: z.string().default(""),
    CORS_ORIGINS: z.string().default(""),

    ONLYOFFICE_ENABLED: bool,
    /** URL Document Server mà TRÌNH DUYỆT truy cập. */
    ONLYOFFICE_PUBLIC_URL: z.string().default(""),
    /** URL Document Server mà API truy cập (trong mạng Docker). */
    ONLYOFFICE_INTERNAL_URL: z.string().default(""),
    /** URL của API mà Document Server gọi tới (tải file, callback). */
    ONLYOFFICE_API_BASE_URL: z.string().default(""),
    ONLYOFFICE_JWT_SECRET: z.string().default(""),
    ONLYOFFICE_FILE_TOKEN_MINUTES: z.coerce.number().int().positive().default(30),
  })
  .superRefine((c, ctx) => {
    if (!c.ONLYOFFICE_ENABLED) return;
    if (c.ONLYOFFICE_JWT_SECRET.length < 32)
      ctx.addIssue({ code: "custom", path: ["ONLYOFFICE_JWT_SECRET"], message: "Tối thiểu 32 ký tự khi bật ONLYOFFICE." });
    for (const key of ["ONLYOFFICE_PUBLIC_URL", "ONLYOFFICE_API_BASE_URL"] as const) {
      if (!URL.canParse(c[key])) ctx.addIssue({ code: "custom", path: [key], message: "Phải là URL tuyệt đối." });
    }
  });

export type Env = z.infer<typeof schema>;

export interface AppConfig {
  env: Env["NODE_ENV"];
  port: number;
  databaseUrl: string;
  dbStartupRetries: number;
  storage: { templatesRoot: string; documentsRoot: string };
  previews: {
    enabled: boolean;
    sofficePath: string;
    pdftoppmPath: string;
    maxPages: number;
    width: number;
    timeoutMs: number;
  };
  adminApiKey: string;
  corsOrigins: string[];
  onlyOffice: {
    enabled: boolean;
    publicUrl: string;
    internalUrl: string;
    apiBaseUrl: string;
    jwtSecret: string;
    fileTokenMinutes: number;
  };
}

export function loadConfig(source: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): AppConfig {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Cấu hình không hợp lệ:\n${details}`);
  }
  const e = parsed.data;
  return {
    env: e.NODE_ENV,
    port: e.PORT,
    databaseUrl: e.DATABASE_URL,
    dbStartupRetries: e.DB_STARTUP_RETRIES,
    storage: {
      templatesRoot: path.resolve(cwd, e.TEMPLATES_ROOT),
      documentsRoot: path.resolve(cwd, e.DOCUMENTS_ROOT),
    },
    previews: {
      enabled: e.PREVIEWS_ENABLED,
      sofficePath: e.SOFFICE_PATH,
      pdftoppmPath: e.PDFTOPPM_PATH,
      maxPages: e.PREVIEW_MAX_PAGES,
      width: e.PREVIEW_WIDTH,
      timeoutMs: e.PREVIEW_TIMEOUT_SECONDS * 1000,
    },
    adminApiKey: e.ADMIN_API_KEY,
    corsOrigins: e.CORS_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean),
    onlyOffice: {
      enabled: e.ONLYOFFICE_ENABLED,
      publicUrl: e.ONLYOFFICE_PUBLIC_URL.replace(/\/+$/, ""),
      internalUrl: (e.ONLYOFFICE_INTERNAL_URL || e.ONLYOFFICE_PUBLIC_URL).replace(/\/+$/, ""),
      apiBaseUrl: e.ONLYOFFICE_API_BASE_URL.replace(/\/+$/, ""),
      jwtSecret: e.ONLYOFFICE_JWT_SECRET,
      fileTokenMinutes: e.ONLYOFFICE_FILE_TOKEN_MINUTES,
    },
  };
}
