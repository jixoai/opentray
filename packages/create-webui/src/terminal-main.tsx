import React from "react";
import ReactDOM from "react-dom/client";

import { TerminalPage } from "./terminal-page";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <TerminalPage />
  </React.StrictMode>,
);
