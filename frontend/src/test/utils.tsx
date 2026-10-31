import { render } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { vi } from "vitest";
import { AppRoutes, createQueryClient } from "../App";
import { QueryClientProvider } from "@tanstack/react-query";

type Handler = (url: URL, init?: RequestInit) => { status?: number; body?: unknown } | undefined;

/** Giả lập fetch theo route: handler trả undefined thì coi là 404. */
export function mockApi(handler: Handler) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const result = handler(url, init);
    const status = result?.status ?? (result ? 200 : 404);
    const body = result?.body ?? (status === 404 ? { status: 404, title: "Không tìm thấy" } : undefined);
    return new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { "Content-Type": status >= 400 ? "application/problem+json" : "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname + location.search}</output>;
}

export function renderApp(path: string) {
  const queryClient = createQueryClient();
  queryClient.setDefaultOptions({ queries: { ...queryClient.getDefaultOptions().queries, retry: false } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
        <Routes>
          <Route path="*" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

export const page = <T,>(items: T[]) => ({ items, page: 1, pageSize: 24, totalCount: items.length, totalPages: 1 });
