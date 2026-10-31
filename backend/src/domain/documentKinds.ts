import type { DocumentKind } from "../generated/prisma/client.js";

export type { DocumentKind };

export interface DocumentFormat {
  kind: DocumentKind;
  extension: ".docx" | ".pptx";
  contentType: string;
  /** Giá trị documentType của ONLYOFFICE. */
  editorType: "word" | "slide";
  /** Thư mục con trong kho template. */
  folder: string;
}

export const FORMATS: Record<DocumentKind, DocumentFormat> = {
  document: {
    kind: "document",
    extension: ".docx",
    contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    editorType: "word",
    folder: "documents",
  },
  presentation: {
    kind: "presentation",
    extension: ".pptx",
    contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    editorType: "slide",
    folder: "presentations",
  },
};

export const DOCUMENT_KINDS = Object.keys(FORMATS) as DocumentKind[];

export function formatFromExtension(ext: string): DocumentFormat | undefined {
  const lower = ext.toLowerCase();
  return Object.values(FORMATS).find((f) => f.extension === lower);
}

export function kindFromManifestType(type: string): DocumentKind | undefined {
  switch (type.toLowerCase()) {
    case "document":
    case "docx":
      return "document";
    case "presentation":
    case "pptx":
      return "presentation";
    default:
      return undefined;
  }
}
