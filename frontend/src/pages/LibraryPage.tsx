import { useEffect, useId, useState } from "react";
import { Link, Outlet, useSearchParams } from "react-router";
import { useCategories, useTemplates } from "../api/hooks";
import type { TemplateSort, TemplateSummary } from "../api/types";
import { EmptyState, ErrorState, SheetSkeletonGrid } from "../components/StateViews";
import type { KindConfig } from "../kinds";

const PAGE_SIZE = 24;

function useDebounced<T>(value: T, delay = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

export function LibraryPage({ config }: { config: KindConfig }) {
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const category = params.get("category") ?? "";
  const sort = (params.get("sort") as TemplateSort | null) ?? "name";
  const page = Math.max(1, Number(params.get("page")) || 1);

  const [input, setInput] = useState(q);
  const debouncedInput = useDebounced(input);
  // Đồng bộ ô tìm kiếm khi q đổi từ bên ngoài (nút "Xóa bộ lọc", back/forward), không ghi đè lúc đang gõ.
  useEffect(() => {
    setInput((current) => (current.trim() === q ? current : q));
  }, [q]);

  const update = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    if (!("page" in patch)) next.delete("page");
    setParams(next, { replace: true });
  };

  useEffect(() => {
    if (debouncedInput.trim() !== q) update({ q: debouncedInput.trim() || undefined });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedInput]);

  const categories = useCategories(config.kind);
  const templates = useTemplates({ type: config.kind, q, category, sort, page, pageSize: PAGE_SIZE });
  const searchId = useId();
  const data = templates.data;
  const filtered = Boolean(q || category);

  return (
    <div className="library">
      <header className="page-head">
        <h1>{config.title}</h1>
        <p className="page-head__intro">{config.intro}</p>
      </header>

      <div className="toolbar" role="search">
        <label htmlFor={searchId} className="visually-hidden">
          Tìm kiếm mẫu
        </label>
        <div className="search">
          <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden>
            <circle cx="9" cy="9" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
            <path d="M13 13l4 4" stroke="currentColor" strokeWidth="1.8" />
          </svg>
          <input
            id={searchId}
            type="search"
            value={input}
            placeholder={config.searchPlaceholder}
            onChange={(e) => setInput(e.target.value)}
            autoComplete="off"
          />
        </div>
        <label className="sort">
          <span>Sắp xếp</span>
          <select value={sort} onChange={(e) => update({ sort: e.target.value === "name" ? undefined : e.target.value })}>
            <option value="name">Theo tên</option>
            <option value="popular">Dùng nhiều nhất</option>
            <option value="newest">Mới cập nhật</option>
          </select>
        </label>
      </div>

      <div className="chips" role="group" aria-label="Lọc theo danh mục">
        <button type="button" className="chip" aria-pressed={!category} onClick={() => update({ category: undefined })}>
          Tất cả
        </button>
        {categories.data?.map((c) => (
          <button
            key={c.slug}
            type="button"
            className="chip"
            aria-pressed={category === c.slug}
            onClick={() => update({ category: category === c.slug ? undefined : c.slug })}
          >
            {c.name}
            <span className="chip__count">{c.templateCount}</span>
          </button>
        ))}
      </div>

      <section aria-live="polite" aria-busy={templates.isFetching}>
        {templates.isPending ? (
          <SheetSkeletonGrid aspect={config.aspect} />
        ) : templates.isError ? (
          <ErrorState error={templates.error} onRetry={() => templates.refetch()} />
        ) : data && data.items.length === 0 ? (
          <EmptyState
            title={filtered ? "Không có mẫu nào khớp" : "Thư viện chưa có mẫu"}
            action={
              filtered && (
                <button type="button" className="btn btn--secondary" onClick={() => update({ q: undefined, category: undefined })}>
                  Xóa bộ lọc
                </button>
              )
            }
          >
            {filtered
              ? `Không tìm thấy mẫu cho “${q || "danh mục đã chọn"}”. Thử từ khóa ngắn hơn hoặc bỏ lọc danh mục.`
              : "Quản trị viên có thể thêm mẫu bằng cách tải file lên hoặc đặt vào kho template."}
          </EmptyState>
        ) : (
          data && (
            <>
              <p className="result-count">
                {data.totalCount} mẫu{q && <> cho “{q}”</>}
              </p>
              <ul className={`grid grid--${config.aspect}`}>
                {data.items.map((t) => (
                  <li key={t.id}>
                    <TemplateCard template={t} config={config} search={params.toString()} />
                  </li>
                ))}
              </ul>
              {data.totalPages > 1 && (
                <nav className="pager" aria-label="Phân trang">
                  <button type="button" className="btn btn--secondary" disabled={page <= 1}
                    onClick={() => update({ page: String(page - 1) })}>
                    Trang trước
                  </button>
                  <span>
                    Trang {page}/{data.totalPages}
                  </span>
                  <button type="button" className="btn btn--secondary" disabled={page >= data.totalPages}
                    onClick={() => update({ page: String(page + 1) })}>
                    Trang sau
                  </button>
                </nav>
              )}
            </>
          )
        )}
      </section>

      <Outlet />
    </div>
  );
}

function TemplateCard({ template, config, search }: { template: TemplateSummary; config: KindConfig; search: string }) {
  const stacked = template.pageCount > 1;
  return (
    <Link className="card" to={{ pathname: `${config.path}/mau/${template.id}`, search }}>
      <div className={`sheet sheet--${config.aspect}${stacked ? " sheet--stacked" : ""}`}>
        {template.thumbnailUrl ? (
          <img src={template.thumbnailUrl} alt="" loading="lazy" />
        ) : (
          <span className="sheet__placeholder">{template.name}</span>
        )}
      </div>
      <div className="card__body">
        <h2 className="card__title">{template.name}</h2>
        <p className="card__desc">{template.description}</p>
        <p className="card__meta">
          <span>{template.category.name}</span>
          {template.pageCount > 0 && (
            <span>
              {template.pageCount} {config.unit}
            </span>
          )}
        </p>
      </div>
    </Link>
  );
}
