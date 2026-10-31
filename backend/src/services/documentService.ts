import { randomUUID } from "node:crypto";
import type { Readable } from "node:stream";
import type { Db } from "../db.js";
import { FORMATS, type DocumentKind } from "../domain/documentKinds.js";
import { safeFileName } from "../domain/text.js";
import type { Prisma } from "../generated/prisma/client.js";
import { NotFoundError, ValidationError } from "../lib/errors.js";
import type { Logger } from "../lib/logger.js";
import type { PlaceholderEngine } from "../ooxml/placeholderEngine.js";
import type { FileStorage } from "../storage/fileStorage.js";
import { paged, urls, type DocumentDto, type PagedResult } from "./dto.js";

export const LIMITS = {
  titleLength: 200,
  fieldValueLength: 2000,
  documentBytes: 50 * 1024 * 1024,
};

export interface CreateDocumentInput {
  title?: string | null;
  fields?: Record<string, string | null | undefined> | null;
}

const withTemplate = {
  template: { select: { name: true, version: true, _count: { select: { previews: true } } } },
} satisfies Prisma.DocumentInclude;
type DocumentRow = Prisma.DocumentGetPayload<{ include: typeof withTemplate }>;

export class DocumentService {
  constructor(
    private readonly db: Db,
    private readonly storage: FileStorage,
    private readonly placeholders: PlaceholderEngine,
    private readonly logger: Logger,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async createFromTemplate(templateId: string, input: CreateDocumentInput): Promise<DocumentDto> {
    const template = await this.db.template.findFirst({
      where: { id: templateId, isActive: true },
      include: { fields: true },
    });
    if (!template) throw new NotFoundError("Template", templateId);

    const title = validateTitle(input.title?.trim() ? input.title : template.name);
    const values = buildValues(template.fields, input.fields ?? {});
    const format = FORMATS[template.kind];

    const source = await this.storage.read("templates", template.filePath);
    const { buffer, replaced } = await this.placeholders.apply(source, template.kind, values, title);

    const id = randomUUID();
    const now = this.now();
    const filePath = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${id.replaceAll("-", "")}${format.extension}`;
    const fileSize = await this.storage.write("documents", filePath, buffer);

    let doc: DocumentRow;
    try {
      [doc] = await this.db.$transaction([
        this.db.document.create({
          data: {
            id,
            templateId: template.id,
            templateVersion: template.version,
            kind: template.kind,
            title,
            filePath,
            fileSize,
            createdAt: now,
            updatedAt: now,
          },
          include: withTemplate,
        }),
        this.db.template.update({ where: { id: template.id }, data: { usageCount: { increment: 1 } } }),
      ]);
    } catch (err) {
      await this.storage.remove("documents", filePath);
      throw err;
    }

    this.logger.info({ documentId: id, templateId, templateVersion: template.version, replaced }, "Created document from template");
    return toDto(doc);
  }

  async list(kind: DocumentKind | undefined, page: number, pageSize: number): Promise<PagedResult<DocumentDto>> {
    const where = kind ? { kind } : {};
    const [total, rows] = await this.db.$transaction([
      this.db.document.count({ where }),
      this.db.document.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: withTemplate,
      }),
    ]);
    return paged(rows.map(toDto), page, pageSize, total);
  }

  async get(id: string): Promise<DocumentDto> {
    return toDto(await this.load(id));
  }

  async rename(id: string, title: unknown): Promise<DocumentDto> {
    await this.load(id);
    const doc = await this.db.document.update({
      where: { id },
      data: { title: validateTitle(typeof title === "string" ? title : ""), updatedAt: this.now() },
      include: withTemplate,
    });
    return toDto(doc);
  }

  async remove(id: string): Promise<void> {
    const doc = await this.db.document.findUnique({ where: { id } });
    if (!doc) throw new NotFoundError("Document", id);
    await this.db.document.delete({ where: { id } });
    await this.storage.remove("documents", doc.filePath);
  }

  async openContent(id: string): Promise<{ stream: Readable; fileName: string; contentType: string; etag: string; lastModified: Date }> {
    const doc = await this.db.document.findUnique({ where: { id } });
    if (!doc) throw new NotFoundError("Document", id);
    if (!(await this.storage.exists("documents", doc.filePath))) throw new NotFoundError("Document file", id);
    const format = FORMATS[doc.kind];
    return {
      stream: this.storage.openRead("documents", doc.filePath),
      fileName: safeFileName(doc.title) + format.extension,
      contentType: format.contentType,
      etag: `"${doc.id.replaceAll("-", "")}-${doc.version}"`,
      lastModified: doc.updatedAt,
    };
  }

  /** Lưu nội dung mới (từ trình soạn thảo hoặc file người dùng tải lên) thành phiên bản kế tiếp. */
  async saveContent(id: string, content: Buffer): Promise<DocumentDto> {
    const doc = await this.load(id);
    if (content.length > LIMITS.documentBytes)
      throw ValidationError.field("file", `File vượt quá ${LIMITS.documentBytes / 1024 / 1024} MB.`);
    if (!(await this.placeholders.isValidPackage(content, doc.kind)))
      throw ValidationError.field("file", `File không phải ${FORMATS[doc.kind].extension} hợp lệ.`);

    const fileSize = await this.storage.write("documents", doc.filePath, content);
    const updated = await this.db.document.update({
      where: { id },
      data: { fileSize, version: { increment: 1 }, updatedAt: this.now() },
      include: withTemplate,
    });
    this.logger.info({ documentId: id, version: updated.version }, "Saved document content");
    return toDto(updated);
  }

  private async load(id: string) {
    const doc = await this.db.document.findUnique({ where: { id }, include: withTemplate });
    if (!doc) throw new NotFoundError("Document", id);
    return doc;
  }
}

function validateTitle(title: string | null | undefined): string {
  const value = (title ?? "").trim();
  if (!value) throw ValidationError.field("title", "Tiêu đề không được để trống.");
  if (value.length > LIMITS.titleLength) throw ValidationError.field("title", `Tiêu đề tối đa ${LIMITS.titleLength} ký tự.`);
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(value)) throw ValidationError.field("title", "Tiêu đề chứa ký tự không hợp lệ.");
  return value;
}

function buildValues(
  fields: { key: string; defaultValue: string | null }[],
  input: Record<string, string | null | undefined>,
): Record<string, string> {
  const known = new Map(fields.map((f) => [f.key, f]));
  const errors: Record<string, string[]> = {};
  const values: Record<string, string> = {};

  for (const [key, value] of Object.entries(input)) {
    if (!known.has(key)) errors[`fields.${key}`] = ["Trường không tồn tại trong template."];
    else if (value != null && typeof value !== "string") errors[`fields.${key}`] = ["Giá trị phải là chuỗi."];
    else if (value && value.length > LIMITS.fieldValueLength) errors[`fields.${key}`] = [`Giá trị tối đa ${LIMITS.fieldValueLength} ký tự.`];
    else if (value?.trim()) values[key] = value.trim();
  }
  if (Object.keys(errors).length > 0) throw new ValidationError(errors);

  // Trường bỏ trống dùng giá trị mặc định (nếu có); nếu không, giữ nguyên placeholder.
  for (const f of fields) if (!(f.key in values) && f.defaultValue?.trim()) values[f.key] = f.defaultValue;
  return values;
}

function toDto(d: DocumentRow): DocumentDto {
  return {
    id: d.id,
    title: d.title,
    kind: d.kind,
    ...(d.templateId && { templateId: d.templateId }),
    ...(d.template && { templateName: d.template.name }),
    templateVersion: d.templateVersion,
    version: d.version,
    fileSize: d.fileSize,
    fileExtension: FORMATS[d.kind].extension,
    ...(d.template && d.templateId && {
      thumbnailUrl: urls.thumbnail(d.templateId, d.template._count.previews, d.template.version),
    }),
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
  };
}
