import type { DocumentKind } from "../domain/documentKinds.js";

// Hợp đồng dữ liệu API – khớp với frontend/src/api/types.ts.

export interface CategoryRef {
  slug: string;
  name: string;
}

export interface CategoryDto extends CategoryRef {
  kind: DocumentKind;
  templateCount: number;
}

export interface TemplateSummaryDto {
  id: string;
  slug: string;
  kind: DocumentKind;
  name: string;
  description: string;
  category: CategoryRef;
  tags: string[];
  thumbnailUrl?: string;
  pageCount: number;
  version: number;
  usageCount: number;
  updatedAt: string;
}

export interface TemplateDetailDto extends Omit<TemplateSummaryDto, "pageCount"> {
  fileSize: number;
  fileExtension: string;
  previews: { pageNumber: number; imageUrl: string }[];
  fields: { key: string; label: string; defaultValue?: string }[];
}

export interface PagedResult<T> {
  items: T[];
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
}

export interface DocumentDto {
  id: string;
  title: string;
  kind: DocumentKind;
  templateId?: string;
  templateName?: string;
  templateVersion: number;
  version: number;
  fileSize: number;
  fileExtension: string;
  thumbnailUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export const urls = {
  preview: (templateId: string, page: number, version: number) =>
    `/api/templates/${templateId}/previews/${page}?v=${version}`,
  thumbnail: (templateId: string, pageCount: number, version: number) =>
    pageCount > 0 ? urls.preview(templateId, 1, version) : undefined,
};

export function paged<T>(items: T[], page: number, pageSize: number, totalCount: number): PagedResult<T> {
  return { items, page, pageSize, totalCount, totalPages: Math.ceil(totalCount / pageSize) };
}
