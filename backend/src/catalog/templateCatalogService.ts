import { createHash } from "node:crypto";
import path from "node:path";
import { z } from "zod";
import type { Db } from "../db.js";
import { FORMATS, formatFromExtension, kindFromManifestType, type DocumentKind } from "../domain/documentKinds.js";
import { normalizeSearch, slugify, SLUG_PATTERN } from "../domain/text.js";
import { ValidationError } from "../lib/errors.js";
import type { Logger } from "../lib/logger.js";
import type { PlaceholderEngine } from "../ooxml/placeholderEngine.js";
import type { PreviewGenerator } from "../previews/previewGenerator.js";
import type { FileStorage } from "../storage/fileStorage.js";

export const MAX_TEMPLATE_BYTES = 30 * 1024 * 1024;

/** Định dạng meta.json đi kèm mỗi template trong kho. */
const manifestSchema = z.object({
  slug: z.string().regex(SLUG_PATTERN).max(80),
  type: z.string(),
  name: z.string().trim().min(1).max(200),
  description: z.string().max(1000).default(""),
  category: z.object({ slug: z.string().trim().min(1).max(80), name: z.string().trim().min(1).max(120) }),
  tags: z.array(z.string()).default([]),
  fields: z
    .array(z.object({ key: z.string(), label: z.string().default(""), defaultValue: z.string().nullish() }))
    .default([]),
});
export type TemplateManifest = z.infer<typeof manifestSchema>;

export interface CatalogSyncResult {
  added: number;
  updated: number;
  unchanged: number;
  deactivated: number;
  errors: string[];
}

export interface UploadTemplateInput {
  name?: string;
  slug?: string;
  description?: string;
  categorySlug?: string;
  categoryName?: string;
  tags?: string;
}

/** Hàng đợi đơn giản để các lần đồng bộ/upload không chạy chồng lên nhau trong một tiến trình. */
let gate: Promise<unknown> = Promise.resolve();
function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const next = gate.then(fn, fn);
  gate = next.catch(() => undefined);
  return next;
}

/**
 * Đồng bộ kho template (thư mục + meta.json) vào CSDL.
 *
 *   {templatesRoot}/{documents|presentations}/{slug}/template.(docx|pptx)
 *                                                   /meta.json
 *                                                   /previews/page-N.png
 */
export class TemplateCatalogService {
  constructor(
    private readonly db: Db,
    private readonly storage: FileStorage,
    private readonly placeholders: PlaceholderEngine,
    private readonly previews: PreviewGenerator,
    private readonly logger: Logger,
  ) {}

  sync(): Promise<CatalogSyncResult> {
    return exclusive(() => this.syncCore());
  }

  private async syncCore(): Promise<CatalogSyncResult> {
    const result: CatalogSyncResult = { added: 0, updated: 0, unchanged: 0, deactivated: 0, errors: [] };
    const seen = new Set<string>();
    const manifests = (await this.storage.list("templates", "", "meta.json", true)).filter(
      (p) => p.split("/").length === 3,
    );

    for (const manifestPath of manifests) {
      try {
        const { slug, outcome } = await this.syncOne(manifestPath);
        seen.add(slug);
        result[outcome]++;
      } catch (err) {
        this.logger.error({ err, manifestPath }, "Bỏ qua template lỗi");
        result.errors.push(`${manifestPath}: ${(err as Error).message}`);
      }
    }

    const gone = await this.db.template.updateMany({
      where: { isActive: true, slug: { notIn: [...seen] } },
      data: { isActive: false, updatedAt: new Date() },
    });
    result.deactivated = gone.count;

    this.logger.info(result, "Template catalog synced");
    return result;
  }

  private async syncOne(manifestPath: string): Promise<{ slug: string; outcome: "added" | "updated" | "unchanged" }> {
    const dir = manifestPath.slice(0, manifestPath.lastIndexOf("/"));
    const manifest = await this.readManifest(manifestPath);

    const kind = kindFromManifestType(manifest.type);
    if (!kind) throw new Error(`type '${manifest.type}' không được hỗ trợ`);
    if (manifest.slug !== path.posix.basename(dir)) throw new Error("slug phải trùng tên thư mục");

    const format = FORMATS[kind];
    const filePath = `${dir}/template${format.extension}`;
    if (!(await this.storage.exists("templates", filePath))) throw new Error(`thiếu file ${filePath}`);

    const bytes = await this.storage.read("templates", filePath);
    if (!(await this.placeholders.isValidPackage(bytes, kind)))
      throw new Error(`${filePath} không phải file ${format.extension} hợp lệ`);

    const sha = createHash("sha256").update(bytes).digest("hex");
    const detected = await this.placeholders.findPlaceholders(bytes, kind);
    const fields = resolveFields(manifest, detected);

    const category = await this.db.category.upsert({
      where: { kind_slug: { kind, slug: manifest.category.slug.toLowerCase() } },
      create: { kind, slug: manifest.category.slug.toLowerCase(), name: manifest.category.name },
      update: { name: manifest.category.name },
    });

    const tags = manifest.tags.map((t) => t.trim()).filter(Boolean);
    const data = {
      name: manifest.name,
      description: manifest.description.trim(),
      categoryId: category.id,
      tags,
      searchText: normalizeSearch(`${manifest.name} ${manifest.description} ${category.name} ${tags.join(" ")}`),
      filePath,
      fileSize: bytes.length,
      isActive: true,
    };

    const existing = await this.db.template.findUnique({ where: { slug: manifest.slug } });
    if (existing && existing.kind !== kind) throw new Error("không được đổi loại tài liệu của template đã có");

    const fileChanged = !!existing && existing.fileSha256 !== sha;
    const metaChanged =
      !existing ||
      fileChanged ||
      !existing.isActive ||
      existing.name !== data.name ||
      existing.description !== data.description ||
      existing.categoryId !== data.categoryId ||
      existing.tags.join("\u0001") !== tags.join("\u0001");

    const template = await this.db.$transaction(async (tx) => {
      const t = existing
        ? await tx.template.update({
            where: { id: existing.id },
            data: {
              ...data,
              ...(fileChanged && { fileSha256: sha, version: { increment: 1 } }),
              ...(metaChanged && { updatedAt: new Date() }),
            },
          })
        : await tx.template.create({ data: { ...data, slug: manifest.slug, kind, fileSha256: sha } });

      // Trường placeholder: thay toàn bộ theo nội dung file hiện tại.
      await tx.templateField.deleteMany({ where: { templateId: t.id } });
      await tx.templateField.createMany({
        data: fields.map((f, i) => ({ templateId: t.id, key: f.key, label: f.label, defaultValue: f.defaultValue, sortOrder: i })),
      });
      return t;
    });

    await this.syncPreviews(template.id, dir, bytes, kind, fields, fileChanged);
    return { slug: manifest.slug, outcome: !existing ? "added" : metaChanged ? "updated" : "unchanged" };
  }

  private async syncPreviews(
    templateId: string,
    dir: string,
    bytes: Buffer,
    kind: DocumentKind,
    fields: ResolvedField[],
    regenerate: boolean,
  ) {
    const previewDir = `${dir}/previews`;
    let files = await this.storage.list("templates", previewDir, "page-*.png");

    if ((regenerate || files.length === 0) && this.previews.enabled) {
      // Render từ bản sao đã điền giá trị mặc định. Trường không có mặc định giữ placeholder.
      const values = Object.fromEntries(
        fields.filter((f) => f.defaultValue?.trim()).map((f) => [f.key, f.defaultValue as string]),
      );
      const { buffer } = await this.placeholders.apply(bytes, kind, values);
      const images = await this.previews.render(buffer, kind);
      if (images.length > 0) {
        await Promise.all(files.map((f) => this.storage.remove("templates", f)));
        for (const [i, image] of images.entries()) await this.storage.write("templates", `${previewDir}/page-${i + 1}.png`, image);
        files = await this.storage.list("templates", previewDir, "page-*.png");
      }
    }

    const pages = files
      .map((imagePath) => ({ imagePath, pageNumber: Number(imagePath.match(/page-(\d+)\.png$/)?.[1]) }))
      .filter((p) => p.pageNumber > 0);

    await this.db.$transaction([
      this.db.templatePreview.deleteMany({ where: { templateId } }),
      this.db.templatePreview.createMany({ data: pages.map((p) => ({ templateId, ...p })) }),
    ]);
  }

  private async readManifest(manifestPath: string): Promise<TemplateManifest> {
    const raw = (await this.storage.read("templates", manifestPath)).toString("utf8");
    const parsed = manifestSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new Error(`meta.json không hợp lệ (${issue.path.join(".")}: ${issue.message})`);
    }
    return parsed.data;
  }

  /** Thêm template mới, hoặc cập nhật file của template cùng slug (version tăng). Trả về id template. */
  async importTemplate(input: UploadTemplateInput, file: Buffer, fileName: string): Promise<string> {
    const format = formatFromExtension(path.extname(fileName));
    if (!format) throw ValidationError.field("file", "Chỉ hỗ trợ file .docx hoặc .pptx.");
    if (file.length > MAX_TEMPLATE_BYTES) throw ValidationError.field("file", "File template vượt quá 30 MB.");

    const name = input.name?.trim();
    if (!name || name.length > 200) throw ValidationError.field("name", "Tên template bắt buộc, tối đa 200 ký tự.");

    const slug = input.slug?.trim() ? input.slug.trim().toLowerCase() : slugify(name);
    if (!SLUG_PATTERN.test(slug) || slug.length > 80) throw ValidationError.field("slug", "Slug chỉ gồm a-z, 0-9 và dấu '-'.");

    if (!(await this.placeholders.isValidPackage(file, format.kind)))
      throw ValidationError.field("file", `File không phải ${format.extension} hợp lệ.`);

    const current = await this.db.template.findUnique({ where: { slug } });
    if (current && current.kind !== format.kind) throw ValidationError.field("slug", "Slug đã được dùng cho loại tài liệu khác.");

    const dir = `${format.folder}/${slug}`;
    const manifestPath = `${dir}/meta.json`;
    const old = (await this.storage.exists("templates", manifestPath)) ? await this.readManifest(manifestPath) : undefined;
    const detected = await this.placeholders.findPlaceholders(file, format.kind);

    const manifest: TemplateManifest = {
      slug,
      type: format.kind,
      name,
      description: input.description?.trim() ?? old?.description ?? "",
      category: {
        slug: input.categorySlug?.trim().toLowerCase() || old?.category.slug || "khac",
        name: input.categoryName?.trim() || old?.category.name || "Khác",
      },
      tags: input.tags !== undefined ? input.tags.split(",").map((t) => t.trim()).filter(Boolean) : (old?.tags ?? []),
      fields: detected.map((key) => old?.fields.find((f) => f.key === key) ?? { key, label: key }),
    };

    await exclusive(async () => {
      await this.storage.write("templates", `${dir}/template${format.extension}`, file);
      await this.storage.write("templates", manifestPath, Buffer.from(JSON.stringify(manifest, null, 2), "utf8"));
    });

    const result = await this.sync();
    const error = result.errors.find((e) => e.startsWith(manifestPath));
    if (error) throw ValidationError.field("file", error);

    const t = await this.db.template.findUniqueOrThrow({ where: { slug }, select: { id: true } });
    return t.id;
  }
}

interface ResolvedField {
  key: string;
  label: string;
  defaultValue: string | null;
}

/** Chỉ giữ trường thật sự có trong file; trường phát hiện mà manifest không khai báo dùng key làm nhãn. */
function resolveFields(manifest: TemplateManifest, detected: string[]): ResolvedField[] {
  const declared = manifest.fields
    .filter((f) => detected.includes(f.key))
    .map((f) => ({ key: f.key, label: f.label.trim() || f.key, defaultValue: f.defaultValue?.trim() || null }));
  const extra = detected
    .filter((k) => !manifest.fields.some((f) => f.key === k))
    .map((key) => ({ key, label: key, defaultValue: null }));
  return [...declared, ...extra];
}
