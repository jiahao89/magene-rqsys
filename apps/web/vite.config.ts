import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// 本地开发身份：仅当显式设置 RQSYS_LOCAL_IDENTITY 时才由代理注入请求头，
// 与 root API 的同一变量配合使用（API 侧还会额外校验非生产环境 + 仅回环地址）。
// 不要把这里当作生产身份方案：目标环境的身份由妙搭 controller 注入 req.userContext。
const localIdentity = process.env.RQSYS_LOCAL_IDENTITY?.trim();
const localIdentityHeader = process.env.RQSYS_LOCAL_IDENTITY_HEADER?.trim() || "x-rqsys-platform-user-id";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      "/api": {
        target: process.env.API_PROXY_TARGET ?? "http://127.0.0.1:8787",
        changeOrigin: true,
        ...(localIdentity ? { headers: { [localIdentityHeader]: localIdentity } } : {}),
      },
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
    css: true,
  },
});
