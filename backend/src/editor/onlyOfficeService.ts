import type { AppConfig } from "../config.js";
import type { Db } from "../db.js";
import { FORMATS } from "../domain/documentKinds.js";
import { NotFoundError } from "../lib/errors.js";
import type { Logger } from "../lib/logger.js";
import type { DocumentService } from "../services/documentService.js";
import { signJwt, verifyJwt } from "./jwt.js";

export interface EditorConfigResult {
  enabled: boolean;
  documentServerUrl?: string;
  config?: Record<string, unknown>;
  message?: string;
}

// Trạng thái callback theo tài liệu API ONLYOFFICE: 2 = sẵn sàng lưu, 6 = force save.
const SAVE_STATUSES = new Set([2, 6]);

export type Fetcher = (url: string) => Promise<Response>;

export class OnlyOfficeService {
  constructor(
    private readonly options: AppConfig["onlyOffice"],
    private readonly db: Db,
    private readonly documents: DocumentService,
    private readonly logger: Logger,
    private readonly fetcher: Fetcher = (url) => fetch(url, { signal: AbortSignal.timeout(120_000) }),
  ) {}

  async getConfig(documentId: string, userName = "Khách"): Promise<EditorConfigResult> {
    const doc = await this.db.document.findUnique({ where: { id: documentId } });
    if (!doc) throw new NotFoundError("Document", documentId);

    if (!this.options.enabled)
      return {
        enabled: false,
        message: "Trình soạn thảo trực tuyến chưa được bật. Bạn có thể tải file về, chỉnh sửa bằng Word/PowerPoint rồi tải lên lại.",
      };

    const format = FORMATS[doc.kind];
    const api = this.options.apiBaseUrl;
    const fileToken = signJwt(
      { purpose: "file", doc: doc.id, exp: Math.floor(Date.now() / 1000) + this.options.fileTokenMinutes * 60 },
      this.options.jwtSecret,
    );

    const config: Record<string, unknown> = {
      document: {
        fileType: format.extension.slice(1),
        key: documentKey(doc.id, doc.version),
        title: doc.title + format.extension,
        url: `${api}/api/documents/${doc.id}/editor-content?token=${encodeURIComponent(fileToken)}`,
        permissions: { edit: true, download: true, print: true, comment: true },
      },
      documentType: format.editorType,
      editorConfig: {
        callbackUrl: `${api}/api/documents/${doc.id}/editor-callback`,
        lang: "vi",
        mode: "edit",
        user: { id: "guest", name: userName },
        customization: { forcesave: true, autosave: true, compactHeader: true },
      },
    };
    config.token = signJwt(config, this.options.jwtSecret);
    return { enabled: true, documentServerUrl: this.options.publicUrl, config };
  }

  validateFileToken(documentId: string, token: string | undefined): boolean {
    if (!this.options.enabled) return false;
    const payload = verifyJwt<{ purpose?: string; doc?: string; exp?: number }>(token, this.options.jwtSecret);
    return payload?.purpose === "file" && payload.doc === documentId && typeof payload.exp === "number";
  }

  /** Trả về mã lỗi theo giao thức ONLYOFFICE: 0 = OK, 1 = lỗi. */
  async handleCallback(documentId: string, body: unknown, authorization?: string): Promise<0 | 1> {
    if (!this.options.enabled) return 1;

    // Token nằm trong body ("token") hoặc header Authorization: Bearer <jwt> với payload { payload: {...} }.
    let token = typeof (body as { token?: unknown })?.token === "string" ? (body as { token: string }).token : undefined;
    let fromHeader = false;
    if (!token && authorization?.toLowerCase().startsWith("bearer ")) {
      token = authorization.slice(7).trim();
      fromHeader = true;
    }

    const verified = verifyJwt<Record<string, unknown>>(token, this.options.jwtSecret);
    if (!verified) {
      this.logger.warn({ documentId }, "Rejected editor callback: invalid token");
      return 1;
    }

    // Chỉ tin dữ liệu nằm trong JWT đã xác thực, không tin body thô.
    const data = (fromHeader && typeof verified.payload === "object" ? verified.payload : verified) as {
      status?: number;
      key?: string;
      url?: string;
    };

    if (typeof data.key !== "string" || !data.key.startsWith(`${documentId.replaceAll("-", "")}_`)) {
      this.logger.warn({ documentId, key: data.key }, "Rejected editor callback: key mismatch");
      return 1;
    }
    if (!SAVE_STATUSES.has(Number(data.status))) return 0; // 1 = đang sửa, 4 = đóng không đổi…

    const downloadUrl = this.toInternalDownloadUrl(data.url);
    if (!downloadUrl) {
      this.logger.warn({ documentId, url: data.url }, "Rejected editor callback: untrusted url");
      return 1;
    }

    try {
      const response = await this.fetcher(downloadUrl);
      if (!response.ok) throw new Error(`Document Server trả ${response.status}`);
      await this.documents.saveContent(documentId, Buffer.from(await response.arrayBuffer()));
      return 0;
    } catch (err) {
      this.logger.error({ err, documentId }, "Saving document from editor failed");
      return 1;
    }
  }

  /**
   * URL file kết quả do Document Server trả về dùng host mà trình duyệt thấy (publicUrl).
   * API chạy trong mạng Docker nên đổi sang internalUrl. URL không thuộc Document Server bị từ chối.
   */
  toInternalDownloadUrl(url: string | undefined): string | null {
    if (!url || !URL.canParse(url)) return null;
    const target = new URL(url);
    if (target.protocol !== "http:" && target.protocol !== "https:") return null;

    const trusted = [this.options.internalUrl, this.options.publicUrl].filter((u) => URL.canParse(u)).map((u) => new URL(u));
    if (!trusted.some((t) => t.protocol === target.protocol && t.host.toLowerCase() === target.host.toLowerCase())) return null;
    return this.options.internalUrl + target.pathname + target.search;
  }
}

export const documentKey = (id: string, version: number) => `${id.replaceAll("-", "")}_${version}`;
