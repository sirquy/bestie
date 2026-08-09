import React, { useState } from "react";
import ReactDOM from "react-dom/client";

import App from "./App";
import { UnlockScreen } from "./features/auth/UnlockScreen";
import "./index.css";
import { DialogProvider } from "./lib/dialogs";
import { registerBestieServiceWorker } from "./lib/pwa";
import { ToastProvider } from "./lib/toasts";

function BestieRoot(): React.ReactElement {
  const [unlocked, setUnlocked] = useState(false);
  return unlocked ? <App onLocked={() => setUnlocked(false)} /> : <UnlockScreen onUnlocked={() => setUnlocked(true)} />;
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <DialogProvider>
      <ToastProvider>
        <BestieRoot />
      </ToastProvider>
    </DialogProvider>
  </React.StrictMode>,
);


registerBestieServiceWorker();
