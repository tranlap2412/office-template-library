import { useEffect, useRef, useState, type FormEvent } from "react";
import { useLocation, useNavigate, useParams } from "react-router";
import { ApiError } from "../api/client";
import { useCreateDocument, useTemplate } from "../api/hooks";
import type { TemplateDetail } from "../api/types";
import { EmptyState, ErrorState, Spinner, errorMessage } from "../components/StateViews";
import type { KindConfig } from "../kinds";

export function TemplatePreviewDialog({ config }: { config: KindConfig }) {
  const { templateId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const template = useTemplate(templateId);

  const close = () => navigate({ pathname: config.path, search: location.search });

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) {
      // jsdom chưa hỗ trợ showModal.
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
    }
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className="preview"
      aria-labelledby="preview-title"
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClick={(e) => {
        if (e.target === dialogRef.current) close(); // bấm ra nền tối để đóng
      }}
    >
      <button type="button" className="preview__close" onClick={close} aria-label="Đóng xem trước">
        <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden>
          <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="2" />
        </svg>
      </button>

      {template.isPending ? (
        <div className="preview__state">
          <Spinner label="Đang mở mẫu…" />
        </div>
      ) : template.isError ? (
        <div className="preview__state">
          {template.error instanceof ApiError && template.error.isNotFound ? (
            <EmptyState
              title="Không tìm thấy mẫu"
              action={<button type="button" className="btn btn--secondary" onClick={close}>Quay lại thư viện</button>}
            >
              Mẫu này không tồn tại hoặc đã bị gỡ khỏi thư viện.
            </EmptyState>
          ) : (
            <ErrorState error={template.error} onRetry={() => template.refetch()} />
          )}
        </div>
      ) : (
        <PreviewContent template={template.data} config={config} />
      )}
    </dialog>
  );
}

function PreviewContent({ template, config }: { template: TemplateDetail; config: KindConfig }) {
  const [current, setCurrent] = useState(0);
  const pages = template.previews;
  const page = pages[current];

  return (
    <div className="preview__layout">
      <section className="viewer" aria-label={`Xem trước ${pages.length} ${config.unit}`}>
        <div className={`viewer__stage viewer__stage--${config.aspect}`}>
          {page ? (
            <img src={page.imageUrl} alt={`${template.name} – ${config.unit} ${page.pageNumber}`} />
          ) : (
            <p className="viewer__empty">Mẫu này chưa có ảnh xem trước.</p>
          )}
        </div>

        {pages.length > 1 && (
          <>
            <div className="viewer__nav">
              <button type="button" className="btn btn--ghost" disabled={current === 0}
                onClick={() => setCurrent((c) => c - 1)} aria-label={`${config.unit} trước`}>
                ‹
              </button>
              <span>
                {config.unit[0].toUpperCase() + config.unit.slice(1)} {current + 1}/{pages.length}
              </span>
              <button type="button" className="btn btn--ghost" disabled={current === pages.length - 1}
                onClick={() => setCurrent((c) => c + 1)} aria-label={`${config.unit} sau`}>
                ›
              </button>
            </div>
            <ol className={`filmstrip filmstrip--${config.aspect}`}>
              {pages.map((p, i) => (
                <li key={p.pageNumber}>
                  <button type="button" aria-current={i === current} onClick={() => setCurrent(i)}
                    aria-label={`Xem ${config.unit} ${p.pageNumber}`}>
                    <img src={p.imageUrl} alt="" loading="lazy" />
                  </button>
                </li>
              ))}
            </ol>
          </>
        )}
      </section>

      <CreatePanel template={template} config={config} />
    </div>
  );
}

function CreatePanel({ template, config }: { template: TemplateDetail; config: KindConfig }) {
  const navigate = useNavigate();
  const create = useCreateDocument();
  const [title, setTitle] = useState(template.name);
  const [values, setValues] = useState<Record<string, string>>({});
  const fieldErrors = create.error instanceof ApiError ? create.error.fieldErrors : {};

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const fields = Object.fromEntries(Object.entries(values).filter(([, v]) => v.trim() !== ""));
    create.mutate(
      { templateId: template.id, title: title.trim(), fields },
      { onSuccess: (doc) => navigate(`/tai-lieu/${doc.id}`) },
    );
  };

  return (
    <form className="panel" onSubmit={submit} noValidate>
      <p className="panel__category">{template.category.name}</p>
      <h2 id="preview-title">{template.name}</h2>
      <p className="panel__desc">{template.description}</p>
      {template.tags.length > 0 && (
        <ul className="tags" aria-label="Thẻ">
          {template.tags.map((t) => <li key={t}>{t}</li>)}
        </ul>
      )}

      <div className="field">
        <label htmlFor="new-doc-title">Tên tài liệu mới</label>
        <input id="new-doc-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} required
          aria-invalid={!!fieldErrors.title} aria-describedby={fieldErrors.title ? "new-doc-title-error" : undefined} />
        {fieldErrors.title && <small id="new-doc-title-error" className="field__error">{fieldErrors.title[0]}</small>}
      </div>

      {template.fields.length > 0 && (
        <details className="fields">
          <summary>Điền trước {template.fields.length} thông tin (không bắt buộc)</summary>
          <p className="fields__hint">Ô để trống sẽ dùng giá trị gợi ý hoặc giữ chỗ để bạn sửa sau trong trình soạn thảo.</p>
          {template.fields.map((f) => (
            <label key={f.key} className="field">
              <span>{f.label}</span>
              <input
                value={values[f.key] ?? ""}
                placeholder={f.defaultValue ?? ""}
                onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                maxLength={2000}
              />
            </label>
          ))}
        </details>
      )}

      {create.isError && !fieldErrors.title && (
        <p className="form-error" role="alert">{errorMessage(create.error)}</p>
      )}

      <button type="submit" className="btn btn--primary btn--block" disabled={create.isPending || !title.trim()}>
        {create.isPending ? "Đang tạo…" : config.kind === "presentation" ? "Tạo bản trình chiếu" : "Tạo văn bản"}
      </button>
      <p className="panel__note">
        Tài liệu mới là bản sao riêng của bạn. Mẫu gốc (phiên bản {template.version}) không thay đổi.
      </p>
    </form>
  );
}
