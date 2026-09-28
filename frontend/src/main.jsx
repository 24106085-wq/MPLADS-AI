// src/main.jsx
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import { applyThemePreference, getStoredThemePreference } from "./utils/theme";
import "./index.css";

// Apply any saved manual dark/light preference before the app renders, so
// there's no flash of the wrong theme on load (see utils/theme.js — this
// is the "system" | "light" | "dark" preference set from Settings).
applyThemePreference(getStoredThemePreference());

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
