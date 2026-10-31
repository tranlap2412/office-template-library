import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { TemplateDetail, TemplateSummary } from "../api/types";
import { mockApi, page, renderApp } from "./utils";

const contract: TemplateSummary = {
  id: "11111111-1111-1111-1111-111111111111",
  slug: "hop-dong-lao-dong",
  kind: "document",
  name: "Hợp đồng lao động",
  description: "Mẫu hợp đồng lao động",
  category: { slug: "nhan-su", name: "Nhân sự" },
  tags: ["hợp đồng"],
  thumbnailUrl: "/api/templates/1/previews/1?v=1",
  pageCount: 2,
  version: 1,
  usageCount: 0,
  updatedAt: "2026-10-29T00:00:00Z",
};
const minutes: TemplateSummary = {
  ...contract,
  id: "22222222-2222-2222-2222-222222222222",
  slug: "bien-ban-cuoc-hop",
  name: "Biên bản cuộc họp",
  category: { slug: "hanh-chinh", name: "Hành chính" },
};
const categories = [
  { slug: "hanh-chinh", name: "Hành chính", kind: "document", templateCount: 1 },
  { slug: "nhan-su", name: "Nhân sự", kind: "document", templateCount: 1 },
];

describe("Thư viện mẫu", () => {
  it("hiển thị skeleton khi tải rồi danh sách mẫu", async () => {
    mockApi((url) => {
      if (url.pathname === "/api/categories") return { body: categories };
      if (url.pathname === "/api/templates") return { body: page([minutes, contract]) };
    });

    renderApp("/van-ban");

    expect(screen.getByLabelText("Đang tải mẫu")).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Hợp đồng lao động" })).toBeInTheDocument();
    expect(screen.getByText("2 mẫu")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Nhân sự/ })).toBeInTheDocument();
  });

  it("gửi từ khóa và danh mục lên API, lưu trên URL", async () => {
    const fetchMock = mockApi((url) => {
      if (url.pathname === "/api/categories") return { body: categories };
      if (url.pathname === "/api/templates") {
        const q = url.searchParams.get("q");
        return { body: page(q ? [contract] : [minutes, contract]) };
      }
    });
    const user = userEvent.setup();
    renderApp("/van-ban");
    await screen.findByRole("heading", { name: "Biên bản cuộc họp" });

    await user.type(screen.getByRole("searchbox"), "hop dong");
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Biên bản cuộc họp" })).not.toBeInTheDocument());
    expect(screen.getByTestId("location")).toHaveTextContent("q=hop+dong");

    await user.click(screen.getByRole("button", { name: /Nhân sự/ }));
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([u]) => String(u).includes("category=nhan-su") && String(u).includes("q=hop+dong"))).toBe(true),
    );
    expect(screen.getByRole("button", { name: /Nhân sự/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("hiển thị trạng thái rỗng và cho phép xóa bộ lọc", async () => {
    mockApi((url) => {
      if (url.pathname === "/api/categories") return { body: categories };
      if (url.pathname === "/api/templates") return { body: page([]) };
    });
    renderApp("/van-ban?q=khong-co");

    expect(await screen.findByText("Không có mẫu nào khớp")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Xóa bộ lọc" }));
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent(/^\/van-ban$/));
  });

  it("hiển thị lỗi và thử lại thành công", async () => {
    let fail = true;
    mockApi((url) => {
      if (url.pathname === "/api/categories") return { body: categories };
      if (url.pathname === "/api/templates")
        return fail ? { status: 500, body: { status: 500, title: "Lỗi hệ thống", detail: "Máy chủ đang bận." } } : { body: page([contract]) };
    });
    renderApp("/van-ban");

    expect(await screen.findByRole("alert")).toHaveTextContent("Máy chủ đang bận.");
    fail = false;
    await userEvent.click(screen.getByRole("button", { name: "Thử lại" }));
    expect(await screen.findByRole("heading", { name: "Hợp đồng lao động" })).toBeInTheDocument();
  });
});

describe("Xem trước và tạo tài liệu", () => {
  const detail: TemplateDetail = {
    ...contract,
    fileSize: 1000,
    fileExtension: ".docx",
    previews: [
      { pageNumber: 1, imageUrl: "/p1.png" },
      { pageNumber: 2, imageUrl: "/p2.png" },
    ],
    fields: [{ key: "TenNguoiLaoDong", label: "Họ tên người lao động" }],
  };

  it("tạo tài liệu với trường đã điền rồi mở trang tài liệu", async () => {
    let posted: unknown;
    mockApi((url, init) => {
      if (url.pathname === "/api/categories") return { body: categories };
      if (url.pathname === "/api/templates") return { body: page([contract]) };
      if (url.pathname === `/api/templates/${contract.id}`) return { body: detail };
      if (url.pathname === `/api/templates/${contract.id}/documents` && init?.method === "POST") {
        posted = JSON.parse(String(init.body));
        return { status: 201, body: { id: "doc-1" } };
      }
      if (url.pathname.startsWith("/api/documents/doc-1")) return { status: 500, body: { status: 500, title: "x" } };
    });
    const user = userEvent.setup();
    renderApp(`/van-ban/mau/${contract.id}`);

    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByRole("heading", { name: "Hợp đồng lao động" })).toBeInTheDocument();
    expect(within(dialog).getByText("Trang 1/2")).toBeInTheDocument();

    await user.click(within(dialog).getByText(/Điền trước 1 thông tin/));
    await user.type(within(dialog).getByLabelText("Họ tên người lao động"), "Trần Văn Lập");
    await user.click(within(dialog).getByRole("button", { name: "Tạo văn bản" }));

    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/tai-lieu/doc-1"));
    expect(posted).toEqual({ title: "Hợp đồng lao động", fields: { TenNguoiLaoDong: "Trần Văn Lập" } });
  });

  it("báo không tìm thấy khi mẫu không tồn tại", async () => {
    mockApi((url) => {
      if (url.pathname === "/api/categories") return { body: categories };
      if (url.pathname === "/api/templates") return { body: page([contract]) };
      return undefined;
    });
    renderApp("/van-ban/mau/khong-ton-tai");

    expect(await screen.findByText("Không tìm thấy mẫu")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Quay lại thư viện" }));
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent(/^\/van-ban$/));
  });

  it("hiển thị lỗi kiểm tra dữ liệu từ máy chủ", async () => {
    mockApi((url, init) => {
      if (url.pathname === "/api/categories") return { body: categories };
      if (url.pathname === "/api/templates") return { body: page([contract]) };
      if (url.pathname === `/api/templates/${contract.id}`) return { body: detail };
      if (init?.method === "POST")
        return { status: 400, body: { status: 400, title: "Dữ liệu không hợp lệ.", errors: { title: ["Tiêu đề tối đa 200 ký tự."] } } };
    });
    renderApp(`/van-ban/mau/${contract.id}`);

    const dialog = await screen.findByRole("dialog");
    await userEvent.click(await within(dialog).findByRole("button", { name: "Tạo văn bản" }));
    expect(await within(dialog).findByText("Tiêu đề tối đa 200 ký tự.")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Tên tài liệu mới")).toHaveAttribute("aria-invalid", "true");
  });
});
