import React from "react";
import ReactDOM from "react-dom/client";

import App from "./App";
import "./index.css";
import { DialogProvider } from "./lib/dialogs";
import { registerBestieServiceWorker } from "./lib/pwa";
import { ToastProvider } from "./lib/toasts";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <DialogProvider>
      <ToastProvider>
        <App />
      </ToastProvider>
    </DialogProvider>
  </React.StrictMode>,
);


registerBestieServiceWorker();
