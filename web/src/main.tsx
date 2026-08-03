import React from "react";
import ReactDOM from "react-dom/client";

import App from "./App";
import "./index.css";
import { DialogProvider } from "./lib/dialogs";
import { registerBestieServiceWorker } from "./lib/pwa";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <DialogProvider>
      <App />
    </DialogProvider>
  </React.StrictMode>,
);


registerBestieServiceWorker();
