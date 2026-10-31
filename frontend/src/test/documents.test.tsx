import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { OfficeDocument } from "../api/types";
import { mockApi, page, renderApp } from "./utils";

const doc: OfficeDocument = {
  id: "doc-1",
  title: "Pitch OfficeFlow",
  kind: "presentation",
  templateId: "t-1",
  templateName: "Giới thiệu sản phẩm",
  templateVersion: 1,
  version: 1,
  fileSize: 1000,
  fileExtension: ".pptx",
  createdAt: "2026-10-29T00:00:00Z",
  updatedAt: "2026-10-29T00:00:00Z",
};

describe("Tài liệu", () => {
  it("khi chưa bật trình soạn thảo: hướng dẫn tải về và tải lên bản đã sửa", async () => {
    let current = doc;
    mockApi((url, init) => {
      if (url.pathname === "/api/documents/doc-1") return { body: current };
      if (url.pathname === "/api/documents/doc-1/editor-config")
        return { body: { enabled: false, message: "Trình soạn thảo trực tuyến chưa được bật." } };
      if (url.pathname === "/api/documents/doc-1/content" && init?.method === "PUT") {
        current = { ...doc, version: 2 };
        return { body: current };
      }
    });
    const user = userEvent.setup();
    renderApp("/tai-lieu/doc-1");

    expect(await screen.findByText("Chỉnh sửa bằng ứng dụng trên máy")).toBeInTheDocument();
    expect(screen.getByText("Trình soạn thảo trực tuyến chưa được bật.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Tải xuống PPTX/ })).toHaveAttribute("href", "/api/documents/doc-1/download");

    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    await user.upload(input, new File(["x"], "pitch.pptx"));
    expect(await screen.findByText("Đã lưu phiên bản 2.")).toBeInTheDocument();
  });

  it("báo tài liệu không tồn tại", async () => {
    mockApi(() => undefined);
    renderApp("/tai-lieu/khong-co");
    expect(await screen.findByText("Không tìm thấy tài liệu")).toBeInTheDocument();
  });

  it("liệt kê, mở và xóa tài liệu", async () => {
    let items = [doc];
    mockApi((url, init) => {
      if (url.pathname === "/api/documents" ) return { body: page(items) };
      if (url.pathname === "/api/documents/doc-1" && init?.method === "DELETE") {
        items = [];
        return { status: 204 };
      }
    });
    window.confirm = () => true;
    const user = userEvent.setup();
    renderApp("/tai-lieu");

    expect(await screen.findByRole("link", { name: "Pitch OfficeFlow" })).toHaveAttribute("href", "/tai-lieu/doc-1");
    await user.click(screen.getByRole("button", { name: "Xóa" }));
    expect(await screen.findByText("Chưa có tài liệu nào")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("link", { name: "Chọn mẫu văn bản" })).toBeInTheDocument());
  });
});
