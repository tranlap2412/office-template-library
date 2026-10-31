import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Link, Navigate, Route, Routes } from "react-router";
import { ApiError } from "./api/client";
import { Layout } from "./components/Layout";
import { EmptyState } from "./components/StateViews";
import { KINDS, kindList } from "./kinds";
import { DocumentEditorPage } from "./pages/DocumentEditorPage";
import { LibraryPage } from "./pages/LibraryPage";
import { MyDocumentsPage } from "./pages/MyDocumentsPage";
import { TemplatePreviewDialog } from "./pages/TemplatePreviewDialog";

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        // Không thử lại với lỗi 4xx (ví dụ 404) – thử lại không giúp gì.
        retry: (count, error) => !(error instanceof ApiError && error.status >= 400 && error.status < 500) && count < 2,
      },
    },
  });
}

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Navigate to={KINDS.document.path} replace />} />
        {kindList.map((k) => (
          <Route key={k.kind} path={k.path} element={<LibraryPage key={k.kind} config={k} />}>
            <Route path="mau/:templateId" element={<TemplatePreviewDialog config={k} />} />
          </Route>
        ))}
        <Route path="/tai-lieu" element={<MyDocumentsPage />} />
        <Route path="/tai-lieu/:documentId" element={<DocumentEditorPage />} />
        <Route
          path="*"
          element={
            <EmptyState title="Không tìm thấy trang" action={<Link className="btn btn--secondary" to="/">Về thư viện mẫu</Link>}>
              Đường dẫn không tồn tại.
            </EmptyState>
          }
        />
      </Route>
    </Routes>
  );
}

export function App({ queryClient = createQueryClient() }: { queryClient?: QueryClient }) {
  return (
    <QueryClientProvider client={queryClient}>
      <AppRoutes />
    </QueryClientProvider>
  );
}
