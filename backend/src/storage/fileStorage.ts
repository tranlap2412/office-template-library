import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Readable } from "node:stream";

export type StorageArea = "templates" | "documents";

/** File trên ổ đĩa. Đường dẫn tương đối, dùng "/". */
export interface FileStorage {
  read(area: StorageArea, relPath: string): Promise<Buffer>;
  openRead(area: StorageArea, relPath: string): Readable;
  exists(area: StorageArea, relPath: string): Promise<boolean>;
  /** Ghi nguyên tử: ghi ra file tạm rồi đổi tên. Trả về số byte. */
  write(area: StorageArea, relPath: string, data: Buffer): Promise<number>;
  remove(area: StorageArea, relPath: string): Promise<void>;
  /** Liệt kê file theo tên chính xác hoặc tiền tố/hậu tố đơn giản (vd "page-*.png"). */
  list(area: StorageArea, relDir: string, pattern: string, recursive?: boolean): Promise<string[]>;
}

export class LocalFileStorage implements FileStorage {
  private readonly roots: Record<StorageArea, string>;

  constructor(roots: { templatesRoot: string; documentsRoot: string }) {
    this.roots = { templates: path.resolve(roots.templatesRoot), documents: path.resolve(roots.documentsRoot) };
  }

  async init() {
    await fs.mkdir(this.roots.templates, { recursive: true });
    await fs.mkdir(this.roots.documents, { recursive: true });
  }

  /** Chặn path traversal: đường dẫn sau chuẩn hóa phải nằm trong thư mục gốc của vùng lưu trữ. */
  resolve(area: StorageArea, relPath: string): string {
    if (!relPath || path.isAbsolute(relPath) || relPath.includes("\0"))
      throw new Error("Đường dẫn lưu trữ không hợp lệ.");
    const root = this.roots[area];
    const full = path.resolve(root, relPath);
    if (!full.startsWith(root + path.sep)) throw new Error("Đường dẫn nằm ngoài vùng lưu trữ.");
    return full;
  }

  read(area: StorageArea, relPath: string) {
    return fs.readFile(this.resolve(area, relPath));
  }

  openRead(area: StorageArea, relPath: string) {
    return createReadStream(this.resolve(area, relPath));
  }

  async exists(area: StorageArea, relPath: string) {
    try {
      return (await fs.stat(this.resolve(area, relPath))).isFile();
    } catch {
      return false;
    }
  }

  async write(area: StorageArea, relPath: string, data: Buffer) {
    const target = this.resolve(area, relPath);
    await fs.mkdir(path.dirname(target), { recursive: true });
    const temp = `${target}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temp, data, { flag: "wx" });
      await fs.rename(temp, target);
    } finally {
      await fs.rm(temp, { force: true });
    }
    return data.length;
  }

  async remove(area: StorageArea, relPath: string) {
    await fs.rm(this.resolve(area, relPath), { force: true });
  }

  async list(area: StorageArea, relDir: string, pattern: string, recursive = false) {
    const root = this.roots[area];
    const dir = relDir ? this.resolve(area, relDir) : root;
    let entries: string[];
    try {
      entries = recursive
        ? ((await fs.readdir(dir, { recursive: true })) as string[])
        : await fs.readdir(dir);
    } catch {
      return [];
    }
    const matcher = globToRegExp(pattern);
    const out: string[] = [];
    for (const entry of entries) {
      const full = path.join(dir, entry);
      if (!matcher.test(path.basename(entry))) continue;
      const stat = await fs.stat(full).catch(() => null);
      if (stat?.isFile()) out.push(path.relative(root, full).split(path.sep).join("/"));
    }
    return out.sort();
  }
}

function globToRegExp(pattern: string) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`);
}
