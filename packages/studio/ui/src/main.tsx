import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ToastProvider } from "./components/toast";
import "./index.css";
import { RunProvider } from "./run";

const root = document.getElementById("root");
if (root)
  createRoot(root).render(
    <StrictMode>
      <ToastProvider>
        <RunProvider>
          <App />
        </RunProvider>
      </ToastProvider>
    </StrictMode>,
  );
