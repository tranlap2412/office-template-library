import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { FORMATS, type DocumentKind } from "../domain/documentKinds.js";
import type { Logger } from "../lib/logger.js";

const run = promisify(execFile);

export interface PreviewGenerator {
  readonly enabled: boolean;
  /** Render tài liệu thành ảnh PNG từng trang/slide, theo thứ tự. Lỗi -> mảng rỗng (preview là tùy chọn). */
  render(file: Buffer, kind: DocumentKind): Promise<Buffer[]>;
}

export interface PreviewOptions {
  enabled: boolean;
  sofficePath: string;
  pdftoppmPath: string;
  maxPages: number;
  width: number;
  timeoutMs: number;
}

/**
 * LibreOffice headless (DOCX/PPTX -> PDF) + poppler pdftoppm (PDF -> PNG).
 * Mỗi lần chạy dùng thư mục tạm và profile LibreOffice riêng nên chạy song song được.
 */
export class LibreOfficePreviewGenerator implements PreviewGenerator {
  constructor(
    private readonly options: PreviewOptions,
    private readonly logger: Logger,
  ) {}

  get enabled() {
    return this.options.enabled;
  }

  async render(file: Buffer, kind: DocumentKind): Promise<Buffer[]> {
    if (!this.enabled) return [];
    const work = await fs.mkdtemp(path.join(os.tmpdir(), "otl-preview-"));
    try {
      const input = path.join(work, `source${FORMATS[kind].extension}`);
      await fs.writeFile(input, file);
      const { timeoutMs, sofficePath, pdftoppmPath, maxPages, width } = this.options;

      await run(
        sofficePath,
        [`-env:UserInstallation=${pathToFileURL(path.join(work, "profile")).href}`, "--headless", "--convert-to", "pdf", "--outdir", work, input],
        { timeout: timeoutMs },
      );
      const pdf = path.join(work, "source.pdf");
      await run(pdftoppmPath, ["-png", "-scale-to", String(width), "-l", String(maxPages), pdf, path.join(work, "page")], {
        timeout: timeoutMs,
      });

      // pdftoppm đặt tên page-1.png hoặc page-01.png tùy tổng số trang -> sắp theo số.
      const pages = (await fs.readdir(work))
        .map((f) => ({ f, n: Number(f.match(/^page-(\d+)\.png$/)?.[1]) }))
        .filter((x) => x.n > 0)
        .sort((a, b) => a.n - b.n);
      return Promise.all(pages.map((p) => fs.readFile(path.join(work, p.f))));
    } catch (err) {
      this.logger.warn({ err }, "Không sinh được ảnh xem trước bằng LibreOffice");
      return [];
    } finally {
      await fs.rm(work, { recursive: true, force: true });
    }
  }
}
