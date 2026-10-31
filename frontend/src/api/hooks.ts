import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";
import type { DocumentKind, TemplateQuery } from "./types";

export const keys = {
  categories: (type: DocumentKind) => ["categories", type] as const,
  templates: (query: TemplateQuery) => ["templates", query] as const,
  template: (id: string) => ["template", id] as const,
  documents: (type?: DocumentKind) => ["documents", type ?? "all"] as const,
  document: (id: string) => ["document", id] as const,
  editor: (id: string, version: number) => ["editor", id, version] as const,
};

export const useCategories = (type: DocumentKind) =>
  useQuery({ queryKey: keys.categories(type), queryFn: () => api.categories(type), staleTime: 5 * 60_000 });

export const useTemplates = (query: TemplateQuery) =>
  useQuery({
    queryKey: keys.templates(query),
    queryFn: () => api.templates(query),
    placeholderData: keepPreviousData, // giữ kết quả cũ khi gõ tìm kiếm, tránh nhấp nháy
  });

export const useTemplate = (id: string | undefined) =>
  useQuery({ queryKey: keys.template(id ?? ""), queryFn: () => api.template(id!), enabled: !!id });

export const useDocuments = (type?: DocumentKind) =>
  useQuery({ queryKey: keys.documents(type), queryFn: () => api.documents(type) });

export const useDocument = (id: string | undefined) =>
  useQuery({ queryKey: keys.document(id ?? ""), queryFn: () => api.document(id!), enabled: !!id });

export function useCreateDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { templateId: string; title: string; fields: Record<string, string> }) =>
      api.createDocument(v.templateId, v.title, v.fields),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["documents"] });
      qc.invalidateQueries({ queryKey: ["templates"] }); // số lượt dùng thay đổi
    },
  });
}

export function useRenameDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; title: string }) => api.renameDocument(v.id, v.title),
    onSuccess: (doc) => {
      qc.setQueryData(keys.document(doc.id), doc);
      qc.invalidateQueries({ queryKey: ["documents"] });
    },
  });
}

export function useDeleteDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteDocument(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["documents"] }),
  });
}

export function useUploadDocumentContent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; file: File }) => api.uploadDocumentContent(v.id, v.file),
    onSuccess: (doc) => {
      qc.setQueryData(keys.document(doc.id), doc);
      qc.invalidateQueries({ queryKey: ["documents"] });
    },
  });
}
