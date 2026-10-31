import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router";
import { api, ApiError } from "../api/client";
import { keys, useDocument, useRenameDocument, useUploadDocumentContent } from "../api/hooks";
import type { EditorConfig, OfficeDocument } from "../api/types";
import { EmptyState, ErrorState, Spinner, errorMessage } from "../components/StateViews";
import { KINDS } from "../kinds";

declare global {
  interface Window {
    DocsAPI?: { DocEditor: new (id: string, config: Record<string, unknown>) => { destroyEditor(): void } };
  }
}

export function DocumentEditorPage() {
  const { documentId } = useParams();
  const doc = useDocument(documentId);

  if (doc.isPending) return <Spinner label="Đang mở tài liệu…" />;
  if (doc.isError) {
    return doc.error instanceof ApiError && doc.error.isNotFound ? (
      <EmptyState title="Không tìm thấy tài liệu" action={<Link className="btn btn--secondary" to="/tai-lieu">Về tài liệu của tôi</Link>}>
        Tài liệu có thể đã bị xóa.
      </EmptyState>
    ) : (
      <ErrorState error={doc.error} onRetry={() => doc.refetch()} />
    );
  }
  return <Editor document={doc.data} />;
}

function Editor({ document: doc }: { document: OfficeDocument }) {
  // Key gồm version: sau khi lưu bản mới, editor được mở lại với document key mới.
  const editor = useQuery({
    queryKey: keys.editor(doc.id, doc.version),
    queryFn: () => api.editorConfig(doc.id),
    placeholderData: keepPreviousData, // không tháo giao diện trong lúc lấy config mới
  });
  const kind = KINDS[doc.kind];

  return (
    <div className="editor-page">
      <header className="editor-bar">
        <Link to="/tai-lieu" className="editor-bar__back" aria-label="Về tài liệu của tôi">
          ‹
        </Link>
        <TitleEditor document={doc} />
        <p className="editor-bar__meta meta">
          <span>{kind.label}</span>
          <span>Phiên bản {doc.version}</span>
          {doc.templateName && <span>Từ mẫu “{doc.templateName}”</span>}
        </p>
        <a className="btn btn--secondary" href={api.downloadUrl(doc.id)} download>
          Tải xuống {doc.fileExtension.toUpperCase().slice(1)}
        </a>
      </header>

      {editor.isPending ? (
        <Spinner label="Đang chuẩn bị trình soạn thảo…" />
      ) : editor.isError ? (
        <ErrorState error={editor.error} onRetry={() => editor.refetch()} />
      ) : editor.data.enabled ? (
        <OnlyOfficeFrame config={editor.data} fallback={<OfflineEditing document={doc} />} />
      ) : (
        <OfflineEditing document={doc} message={editor.data.message} />
      )}
    </div>
  );
}

function TitleEditor({ document: doc }: { document: OfficeDocument }) {
  const rename = useRenameDocument();
  const [title, setTitle] = useState(doc.title);
  useEffect(() => setTitle(doc.title), [doc.title]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (title.trim() && title.trim() !== doc.title) rename.mutate({ id: doc.id, title: title.trim() });
  };

  return (
    <form className="title-form" onSubmit={submit}>
      <label className="visually-hidden" htmlFor="doc-title">Tên tài liệu</label>
      <input
        id="doc-title"
        value={title}
        maxLength={200}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={submit}
        aria-invalid={rename.isError}
        title={rename.isError ? errorMessage(rename.error) : "Đổi tên tài liệu"}
      />
    </form>
  );
}

function OnlyOfficeFrame({ config, fallback }: { config: EditorConfig; fallback: React.ReactNode }) {
  const [status, setStatus] = useState<"loading" | "ready" | "failed">("loading");
  const instance = useRef<{ destroyEditor(): void } | null>(null);
  const holderId = "onlyoffice-editor";

  useEffect(() => {
    let cancelled = false;
    const src = `${config.documentServerUrl}/web-apps/apps/api/documents/api.js`;

    const init = () => {
      if (cancelled || !window.DocsAPI) return;
      instance.current?.destroyEditor();
      instance.current = new window.DocsAPI.DocEditor(holderId, {
        ...config.config,
        width: "100%",
        height: "100%",
        events: { onAppReady: () => !cancelled && setStatus("ready") },
      });
    };

    let script = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
    if (window.DocsAPI) init();
    else {
      if (!script) {
        script = document.createElement("script");
        script.src = src;
        script.async = true;
        document.body.appendChild(script);
      }
      script.addEventListener("load", init);
      script.addEventListener("error", () => !cancelled && setStatus("failed"));
    }

    const timeout = window.setTimeout(() => !cancelled && setStatus((s) => (s === "loading" ? "failed" : s)), 30_000);
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
      script?.removeEventListener("load", init);
      instance.current?.destroyEditor();
      instance.current = null;
    };
  }, [config]);

  if (status === "failed") {
    return (
      <>
        <p className="notice notice--warn" role="alert">
          Không kết nối được trình soạn thảo trực tuyến ({config.documentServerUrl}). Bạn vẫn có thể chỉnh sửa bằng ứng dụng trên máy.
        </p>
        {fallback}
      </>
    );
  }

  return (
    <div className="editor-frame">
      {status === "loading" && <Spinner label="Đang tải trình soạn thảo…" />}
      <div id={holderId} />
    </div>
  );
}

function OfflineEditing({ document: doc, message }: { document: OfficeDocument; message?: string }) {
  const upload = useUploadDocumentContent();
  const input = useRef<HTMLInputElement>(null);
  const app = doc.kind === "presentation" ? "PowerPoint, LibreOffice Impress" : "Word, LibreOffice Writer";

  return (
    <section className="offline">
      {doc.thumbnailUrl && (
        <div className={`sheet sheet--${KINDS[doc.kind].aspect} offline__preview`}>
          <img src={doc.thumbnailUrl} alt="" />
        </div>
      )}
      <div className="offline__body">
        <h2>Chỉnh sửa bằng ứng dụng trên máy</h2>
        {message && <p className="notice">{message}</p>}
        <ol className="steps">
          <li>
            <a href={api.downloadUrl(doc.id)} download>Tải xuống file {doc.fileExtension}</a> của tài liệu.
          </li>
          <li>Mở và chỉnh sửa bằng {app} hoặc ứng dụng tương thích.</li>
          <li>Tải bản đã sửa lên để lưu thành phiên bản {doc.version + 1}.</li>
        </ol>
        <input
          ref={input}
          type="file"
          className="visually-hidden"
          accept={doc.fileExtension}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) upload.mutate({ id: doc.id, file });
            e.target.value = "";
          }}
        />
        <button type="button" className="btn btn--primary" disabled={upload.isPending} onClick={() => input.current?.click()}>
          {upload.isPending ? "Đang tải lên…" : "Tải lên bản đã sửa"}
        </button>
        {upload.isSuccess && <p className="notice notice--ok" role="status">Đã lưu phiên bản {upload.data.version}.</p>}
        {upload.isError && <p className="form-error" role="alert">{errorMessage(upload.error)}</p>}
      </div>
    </section>
  );
}
