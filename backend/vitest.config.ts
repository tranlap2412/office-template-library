import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globalSetup: ["./test/support/globalSetup.ts"],
    // Các file test dùng chung một CSDL test -> chạy tuần tự để dữ liệu không chồng chéo.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
