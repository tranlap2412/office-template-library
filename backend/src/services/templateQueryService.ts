import type { Readable } from "node:stream";
import type { Db } from "../db.js";
import { FORMATS, type DocumentKind } from "../domain/documentKinds.js";
import { normalizeSearch } from "../domain/text.js";
import type { Prisma } from "../generated/prisma/client.js";
import { NotFoundError } from "../lib/errors.js";
import type { FileStorage } from "../storage/fileStorage.js";
import { paged, urls, type CategoryDto, type PagedResult, type TemplateDetailDto, type TemplateSummaryDto } from "./dto.js";

export type TemplateSort = "name" | "newest" | "popular";

export interface TemplateQuery {
  type?: DocumentKind;
  q?: string;
  category?: string;
  sort: TemplateSort;
  page: number;
  pageSize: number;
}

export class TemplateQueryService {
  constructor(
    private readonly db: Db,
    private readonly storage: FileStorage,
  ) {}

  async search(query: TemplateQuery): Promise<PagedResult<TemplateSummaryDto>> {
    // Tìm theo từng từ, không phân biệt dấu: "hop dong" khớp "Hợp đồng lao động".
    const terms = normalizeSearch(query.q).split(" ").filter(Boolean).slice(0, 8);
    const where: Prisma.TemplateWhereInput = {
      isActive: true,
      ...(query.type && { kind: query.type }),
      ...(query.category && { category: { slug: query.category.trim().toLowerCase() } }),
      AND: terms.map((term) => ({ searchText: { contains: term } })),
    };
    const orderBy: Prisma.TemplateOrderByWithRelationInput[] =
      query.sort === "newest"
        ? [{ updatedAt: "desc" }, { name: "asc" }]
        : query.sort === "popular"
          ? [{ usageCount: "desc" }, { name: "asc" }]
          : [{ name: "asc" }];

    const [total, rows] = await this.db.$transaction([
      this.db.template.count({ where }),
      this.db.template.findMany({
        where,
        orderBy,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: { category: true, _count: { select: { previews: true } } },
      }),
    ]);

    const items = rows.map((t) => ({
      id: t.id,
      slug: t.slug,
      kind: t.kind,
      name: t.name,
      description: t.description,
      category: { slug: t.category.slug, name: t.category.name },
      tags: t.tags,
      thumbnailUrl: urls.thumbnail(t.id, t._count.previews, t.version),
      pageCount: t._count.previews,
      version: t.version,
      usageCount: t.usageCount,
      updatedAt: t.updatedAt.toISOString(),
    }));
    return paged(items, query.page, query.pageSize, total);
  }

  async get(id: string): Promise<TemplateDetailDto> {
    const t = await this.db.template.findFirst({
      where: { id, isActive: true },
      include: {
        category: true,
        previews: { orderBy: { pageNumber: "asc" } },
        fields: { orderBy: { sortOrder: "asc" } },
      },
    });
    if (!t) throw new NotFoundError("Template", id);

    return {
      id: t.id,
      slug: t.slug,
      kind: t.kind,
      name: t.name,
      description: t.description,
      category: { slug: t.category.slug, name: t.category.name },
      tags: t.tags,
      thumbnailUrl: urls.thumbnail(t.id, t.previews.length, t.version),
      version: t.version,
      usageCount: t.usageCount,
      updatedAt: t.updatedAt.toISOString(),
      fileSize: t.fileSize,
      fileExtension: FORMATS[t.kind].extension,
      previews: t.previews.map((p) => ({ pageNumber: p.pageNumber, imageUrl: urls.preview(t.id, p.pageNumber, t.version) })),
      fields: t.fields.map((f) => ({ key: f.key, label: f.label, ...(f.defaultValue ? { defaultValue: f.defaultValue } : {}) })),
    };
  }

  async categories(kind?: DocumentKind): Promise<CategoryDto[]> {
    const rows = await this.db.category.findMany({
      where: { ...(kind && { kind }), templates: { some: { isActive: true } } },
      orderBy: { name: "asc" },
      include: { _count: { select: { templates: { where: { isActive: true } } } } },
    });
    return rows.map((c) => ({ slug: c.slug, name: c.name, kind: c.kind, templateCount: c._count.templates }));
  }

  async previewImage(id: string, page: number): Promise<{ stream: Readable; etag: string; lastModified: Date }> {
    const preview = await this.db.templatePreview.findFirst({
      where: { templateId: id, pageNumber: page, template: { isActive: true } },
      include: { template: { select: { version: true, updatedAt: true } } },
    });
    if (!preview || !(await this.storage.exists("templates", preview.imagePath)))
      throw new NotFoundError("Preview", `${id}/${page}`);

    return {
      stream: this.storage.openRead("templates", preview.imagePath),
      etag: `"${id.replaceAll("-", "")}-${preview.template.version}-${page}"`,
      lastModified: preview.template.updatedAt,
    };
  }
}
