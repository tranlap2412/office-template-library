import "dotenv/config";

/** CSDL riêng cho test – bị xóa và tạo lại mỗi lần chạy. KHÔNG trỏ vào CSDL thật. */
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/office_templates_test";
