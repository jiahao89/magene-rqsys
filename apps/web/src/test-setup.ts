import "@testing-library/jest-dom/vitest";
import "@arco-design/web-react/es/_util/react-19-adapter";
import "@arco-design/web-react/lib/_util/react-19-adapter";
import { Message } from "@arco-design/web-react";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
  Message.clear();
  document.querySelectorAll(".arco-message-wrapper").forEach((node) => node.remove());
});

// jsdom 不实现 matchMedia；Arco 的响应式 Grid/Descriptions 会在挂载时调用它。
// 所有查询一律返回不匹配（等价于桌面默认断点），仅用于让组件树能渲染，真实断点行为由浏览器验证。
if (typeof window !== "undefined" && typeof window.matchMedia !== "function") {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
}
