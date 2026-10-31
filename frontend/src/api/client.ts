import type {
  Category,
  DocumentKind,
  EditorConfig,
  OfficeDocument,
  PagedResult,
  TemplateDetail,
  TemplateQuery,
  TemplateSummary,
} from "./types";

/** Lỗi API, mang thông tin từ ProblemDetails (RFC 7807) của backend. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly fieldErrors: Record<string, string[]> = {},
  ) {
    super(message);
    this.name = "ApiError";
  }

  get isNotFound() {
    return this.status === 404;
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: { Accept: "application/json", ...(init?.headers ?? {}) },
    });
  } catch {
    throw new ApiError(0, "Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.");
  }

  if (!response.ok) {
    let message = `Yêu cầu thất bại (${response.status}).`;
    let fieldErrors: Record<string, string[]> = {};
    try {
      const problem = await response.json();
      message = problem.detail ?? problem.title ?? message;
      fieldErrors = problem.errors ?? {};
      const first = Object.values(fieldErrors)[0]?.[0];
      if (first && problem.status === 400) message = first;
    } catch {
      /* phản hồi không phải JSON */
    }
    if (response.status === 429) message = "Bạn thao tác quá nhanh, vui lòng thử lại sau ít phút.";
    throw new ApiError(response.status, message, fieldErrors);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

function qs(params: Record<string, string | number | undefined>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") search.set(key, String(value));
  }
  const s = search.toString();
  return s ? `?${s}` : "";
}

const json = (body: unknown): RequestInit => ({
  body: JSON.stringify(body),
  headers: { "Content-Type": "application/json" },
});

export const api = {
  categories: (type: DocumentKind) => request<Category[]>(`/api/categories${qs({ type })}`),

  templates: (query: TemplateQuery) =>
    request<PagedResult<TemplateSummary>>(`/api/templates${qs({ ...query })}`),

  template: (id: string) => request<TemplateDetail>(`/api/templates/${encodeURIComponent(id)}`),

  createDocument: (templateId: string, title: string, fields: Record<string, string>) =>
    request<OfficeDocument>(`/api/templates/${encodeURIComponent(templateId)}/documents`, {
      method: "POST",
      ...json({ title, fields }),
    }),

  documents: (type?: DocumentKind, page = 1) =>
    request<PagedResult<OfficeDocument>>(`/api/documents${qs({ type, page, pageSize: 50 })}`),

  document: (id: string) => request<OfficeDocument>(`/api/documents/${encodeURIComponent(id)}`),

  renameDocument: (id: string, title: string) =>
    request<OfficeDocument>(`/api/documents/${encodeURIComponent(id)}`, { method: "PATCH", ...json({ title }) }),

  deleteDocument: (id: string) =>
    request<void>(`/api/documents/${encodeURIComponent(id)}`, { method: "DELETE" }),

  uploadDocumentContent: (id: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request<OfficeDocument>(`/api/documents/${encodeURIComponent(id)}/content`, { method: "PUT", body: form });
  },

  editorConfig: (id: string) => request<EditorConfig>(`/api/documents/${encodeURIComponent(id)}/editor-config`),

  downloadUrl: (id: string) => `/api/documents/${encodeURIComponent(id)}/download`,
};
