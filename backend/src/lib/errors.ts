/** Lỗi nghiệp vụ, được middleware chuyển thành ProblemDetails (RFC 7807). */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly title: string,
    message?: string,
  ) {
    super(message ?? title);
    this.name = new.target.name;
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, id: unknown) {
    super(404, "Không tìm thấy", `${resource} '${String(id)}' không tồn tại.`);
  }
}

export class ValidationError extends AppError {
  constructor(public readonly errors: Record<string, string[]>) {
    super(400, "Dữ liệu không hợp lệ.");
  }

  static field(field: string, message: string) {
    return new ValidationError({ [field]: [message] });
  }
}

export class UnauthorizedError extends AppError {
  constructor(message: string) {
    super(401, "Chưa xác thực", message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message: string) {
    super(403, "Không có quyền", message);
  }
}
