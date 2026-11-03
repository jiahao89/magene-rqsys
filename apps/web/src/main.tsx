import React from "react";
import ReactDOM from "react-dom/client";
import { ConfigProvider } from "@arco-design/web-react";
import zhCN from "@arco-design/web-react/es/locale/zh-CN";
import "@arco-design/web-react/es/_util/react-19-adapter";
import "./arco-styles";
import App from "./App";
import "./styles.css";

// ARCO-08（目标 A）：只接入 Arco 的 zhCN locale（空态/日期/分页等内置文案），不覆盖品牌 token。
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ConfigProvider locale={zhCN}>
      <App />
    </ConfigProvider>
  </React.StrictMode>,
);
