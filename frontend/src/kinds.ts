import type { DocumentKind } from "./api/types";

export interface KindConfig {
  kind: DocumentKind;
  path: string;
  label: string;
  title: string;
  intro: string;
  unit: string;
  /** Tỉ lệ trang dùng cho khung xem trước: A4 dọc hoặc slide 16:9. */
  aspect: "page" | "slide";
  searchPlaceholder: string;
}

export const KINDS: Record<DocumentKind, KindConfig> = {
  document: {
    kind: "document",
    path: "/van-ban",
    label: "Văn bản",
    title: "Mẫu văn bản",
    intro: "Hợp đồng, biên bản, đơn từ… chọn một mẫu để tạo văn bản mới, mẫu gốc luôn được giữ nguyên.",
    unit: "trang",
    aspect: "page",
    searchPlaceholder: "Tìm mẫu văn bản, ví dụ: hợp đồng, nghỉ phép",
  },
  presentation: {
    kind: "presentation",
    path: "/trinh-chieu",
    label: "Trình chiếu",
    title: "Mẫu trình chiếu",
    intro: "Bộ slide dựng sẵn cho báo cáo, giới thiệu sản phẩm, đào tạo… tạo bản trình chiếu riêng chỉ với một bước.",
    unit: "slide",
    aspect: "slide",
    searchPlaceholder: "Tìm mẫu trình chiếu, ví dụ: báo cáo, kế hoạch",
  },
};

export const kindList = Object.values(KINDS);
