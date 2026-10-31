import { useState } from "react";
import { Link } from "react-router";
import { api } from "../api/client";
import { useDeleteDocument, useDocuments } from "../api/hooks";
import type { DocumentKind } from "../api/types";
import { EmptyState, ErrorState, Spinner, errorMessage } from "../components/StateViews";
import { KINDS, kindList } from "../kinds";

const dateFormat = new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short" });

export function MyDocumentsPage() {
  const [filter, setFilter] = useState<DocumentKind | undefined>();
  const documents = useDocuments(filter);
  const remove = useDeleteDocument();

  return (
    <div className="library">
      <header className="page-head">
        <h1>Tài liệu của tôi</h1>
        <p className="page-head__intro">Các tài liệu bạn đã tạo từ thư viện mẫu, mới chỉnh sửa gần đây ở trên cùng.</p>
      </header>

      <div className="chips" role="group" aria-label="Lọc theo loại">
        <button type="button" className="chip" aria-pressed={!filter} onClick={() => setFilter(undefined)}>
          Tất cả
        </button>
        {kindList.map((k) => (
          <button key={k.kind} type="button" className="chip" aria-pressed={filter === k.kind} onClick={() => setFilter(k.kind)}>
            {k.label}
          </button>
        ))}
      </div>

      {remove.isError && <p className="form-error" role="alert">{errorMessage(remove.error)}</p>}

      {documents.isPending ? (
        <Spinner label="Đang tải tài liệu…" />
      ) : documents.isError ? (
        <ErrorState error={documents.error} onRetry={() => documents.refetch()} />
      ) : documents.data.items.length === 0 ? (
        <EmptyState
          title="Chưa có tài liệu nào"
          action={
            <span className="state__actions">
              <Link className="btn btn--primary" to={KINDS.document.path}>Chọn mẫu văn bản</Link>
              <Link className="btn btn--secondary" to={KINDS.presentation.path}>Chọn mẫu trình chiếu</Link>
            </span>
          }
        >
          Tạo tài liệu đầu tiên từ một mẫu trong thư viện.
        </EmptyState>
      ) : (
        <ul className="doc-list">
          {documents.data.items.map((d) => (
            <li key={d.id} className="doc-row">
              <div className={`sheet sheet--${KINDS[d.kind].aspect} doc-row__thumb`}>
                {d.thumbnailUrl && <img src={d.thumbnailUrl} alt="" loading="lazy" />}
              </div>
              <div className="doc-row__main">
                <Link to={`/tai-lieu/${d.id}`} className="doc-row__title">{d.title}</Link>
                <p className="meta">
                  <span>{KINDS[d.kind].label}</span>
                  {d.templateName && <span>Mẫu “{d.templateName}”</span>}
                  <span>Phiên bản {d.version}</span>
                  <span>Sửa lúc {dateFormat.format(new Date(d.updatedAt))}</span>
                </p>
              </div>
              <div className="doc-row__actions">
                <Link className="btn btn--secondary" to={`/tai-lieu/${d.id}`}>Mở</Link>
                <a className="btn btn--ghost" href={api.downloadUrl(d.id)} download>Tải xuống</a>
                <button
                  type="button"
                  className="btn btn--ghost btn--danger"
                  disabled={remove.isPending}
                  onClick={() => {
                    if (window.confirm(`Xóa tài liệu “${d.title}”? Thao tác này không hoàn tác được.`)) remove.mutate(d.id);
                  }}
                >
                  Xóa
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
