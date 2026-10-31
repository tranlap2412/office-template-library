import type { ReactNode } from "react";
import { ApiError } from "../api/client";

export function errorMessage(error: unknown) {
  if (error instanceof ApiError) return error.message;
  return "Đã có lỗi không xác định.";
}

export function ErrorState({ error, onRetry, title = "Không tải được dữ liệu" }: {
  error: unknown;
  onRetry?: () => void;
  title?: string;
}) {
  return (
    <div className="state state--error" role="alert">
      <p className="state__title">{title}</p>
      <p className="state__body">{errorMessage(error)}</p>
      {onRetry && (
        <button type="button" className="btn btn--secondary" onClick={onRetry}>
          Thử lại
        </button>
      )}
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="state" role="status">
      <p className="state__title">{title}</p>
      {children && <p className="state__body">{children}</p>}
      {action}
    </div>
  );
}

export function SheetSkeletonGrid({ aspect, count = 8 }: { aspect: "page" | "slide"; count?: number }) {
  return (
    <div className={`grid grid--${aspect}`} aria-busy="true" aria-label="Đang tải mẫu">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="card card--skeleton">
          <div className={`sheet sheet--${aspect} skeleton`} />
          <div className="skeleton skeleton--line" />
          <div className="skeleton skeleton--line skeleton--short" />
        </div>
      ))}
    </div>
  );
}

export function Spinner({ label }: { label: string }) {
  return (
    <div className="spinner" role="status">
      <span className="spinner__dot" aria-hidden />
      {label}
    </div>
  );
}
