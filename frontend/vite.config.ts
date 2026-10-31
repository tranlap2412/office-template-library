/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Gọi API cùng origin trong lúc dev, giống cấu hình nginx khi chạy Docker.
    proxy: { "/api": { target: process.env.API_URL ?? "http://localhost:5080", changeOrigin: true } },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    css: false,
  },
});
