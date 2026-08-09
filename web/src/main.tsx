import React, { useState } from "react";
import ReactDOM from "react-dom/client";

import App from "./App";
import { IdleLockMonitor } from "./features/auth/IdleLockMonitor";
import { UnlockScreen } from "./features/auth/UnlockScreen";
import "./index.css";
import { DialogProvider } from "./lib/dialogs";
import { registerBestieServiceWorker } from "./lib/pwa";
import { ToastProvider } from "./lib/toasts";

function BestieRoot(): React.ReactElement {
  const [unlocked, setUnlocked] = useState(false);
  const lock = (): void => setUnlocked(false);
  return unlocked ? <><App onLocked={lock} /><IdleLockMonitor onLocked={lock} /></> : <UnlockScreen onUnlocked={() => setUnlocked(true)} />;
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
