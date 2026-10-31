export type DocumentKind = "document" | "presentation";
export type TemplateSort = "name" | "newest" | "popular";

export interface CategoryRef {
  slug: string;
  name: string;
}

export interface Category extends CategoryRef {
  kind: DocumentKind;
  templateCount: number;
}

export interface TemplateSummary {
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

export interface TemplateField {
  key: string;
  label: string;
  defaultValue?: string;
}

export interface TemplateDetail extends Omit<TemplateSummary, "pageCount"> {
  fileSize: number;
  fileExtension: string;
  previews: { pageNumber: number; imageUrl: string }[];
  fields: TemplateField[];
}

export interface PagedResult<T> {
  items: T[];
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
}

export interface OfficeDocument {
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

export interface EditorConfig {
  enabled: boolean;
  documentServerUrl?: string;
  config?: Record<string, unknown>;
  message?: string;
}

export interface TemplateQuery {
  type: DocumentKind;
  q?: string;
  category?: string;
  sort?: TemplateSort;
  page?: number;
  pageSize?: number;
}
