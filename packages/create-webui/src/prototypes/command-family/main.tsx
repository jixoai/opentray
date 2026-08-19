/**
 * Prototype entry: 用户已选定「分域表单」方向并收敛为单行 InputGroup +
 * 表单 Dialog（2026-08-19）。其余变体已删除，本入口只渲染最终精化设计。
 */
import * as React from "react";
import { createRoot } from "react-dom/client";

import "@/index.css";
import { FamilyCommandPage } from "./family-command-card";

const container = document.getElementById("root");
if (container === null) {
  throw new Error("prototype root container missing");
}
createRoot(container).render(
  <React.StrictMode>
    <FamilyCommandPage />
  </React.StrictMode>,
);
