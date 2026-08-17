import React from "react";
import ReactDOM from "react-dom/client";

import { App } from "./app";
import { PreferencesProvider, applyDocumentChrome, readInitialPreferences } from "./preferences";
import "./index.css";

// Before-paint theme/locale resolution: no wrong-theme flash on first frame.
const initial = readInitialPreferences();
applyDocumentChrome(initial.locale, initial.theme);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <PreferencesProvider initialLocale={initial.locale} initialTheme={initial.theme}>
      <App />
    </PreferencesProvider>
  </React.StrictMode>,
);
