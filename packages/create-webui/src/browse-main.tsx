import React from "react";
import ReactDOM from "react-dom/client";

import { BrowsePage } from "./browse-page";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowsePage />
  </React.StrictMode>,
);
