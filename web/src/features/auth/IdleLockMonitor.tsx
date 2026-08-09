import { type ReactElement, useEffect, useRef, useState } from "react";
import { Loader2, LockKeyhole, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { fetchJson, setCsrfToken } from "@/lib/api";

const IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const WARNING_MS = 60 * 1000;
const HEARTBEAT_INTERVAL_MS = 60 * 1000;

interface AuthStatus {
  authenticated: boolean;
  csrfToken?: string;
}

export function IdleLockMonitor({ onLocked }: { onLocked: () => void }): ReactElement | null {
  const [warning, setWarning] = useState(false);
  const [busy, setBusy] = useState(false);
  const lastActivityAt = useRef(Date.now());
  const lastHeartbeatAt = useRef(0);
  const warningRef = useRef(false);

  useEffect(() => {
    async function heartbeat(): Promise<boolean> {
      try {
        const status = await fetchJson<AuthStatus>("/api/auth/status?touch=1");
        if (!status.authenticated) {
          setCsrfToken(undefined);
          onLocked();
          return false;
        }
        if (status.csrfToken) setCsrfToken(status.csrfToken);
        lastHeartbeatAt.current = Date.now();
        return true;
      } catch {
        return false;
      }
    }

    function registerActivity(): void {
      if (warningRef.current) return;
      lastActivityAt.current = Date.now();
      const now = Date.now();
      if (now - lastHeartbeatAt.current >= HEARTBEAT_INTERVAL_MS) void heartbeat();
    }

    async function lockForIdle(): Promise<void> {
      setBusy(true);
      try {
        await fetchJson("/api/auth/logout", { method: "POST" });
      } catch {
      } finally {
        setCsrfToken(undefined);
        onLocked();
      }
    }

    function checkIdle(): void {
      const remaining = IDLE_TIMEOUT_MS - (Date.now() - lastActivityAt.current);
      if (remaining <= 0) {
        void lockForIdle();
        return;
      }
      if (remaining <= WARNING_MS && !warningRef.current) {
        warningRef.current = true;
        setWarning(true);
      }
    }

    const events: Array<keyof DocumentEventMap> = ["pointerdown", "keydown", "touchstart"];
    for (const event of events) document.addEventListener(event, registerActivity, { passive: true });
    const timer = window.setInterval(checkIdle, 1000);
    return () => {
      for (const event of events) document.removeEventListener(event, registerActivity);
      window.clearInterval(timer);
    };
  }, [onLocked]);

  async function continueSession(): Promise<void> {
    setBusy(true);
    try {
      const status = await fetchJson<AuthStatus>("/api/auth/status?touch=1");
      if (!status.authenticated) {
        setCsrfToken(undefined);
        onLocked();
        return;
      }
      if (status.csrfToken) setCsrfToken(status.csrfToken);
      lastActivityAt.current = Date.now();
      lastHeartbeatAt.current = Date.now();
      warningRef.current = false;
      setWarning(false);
    } catch {
      setCsrfToken(undefined);
      onLocked();
    } finally {
      setBusy(false);
    }
  }

  async function lockNow(): Promise<void> {
    setBusy(true);
    try {
      await fetchJson("/api/auth/logout", { method: "POST" });
    } catch {
    } finally {
      setCsrfToken(undefined);
      onLocked();
    }
  }

  if (!warning) return null;
  return (
    <div className="fixed inset-0 z-[70] grid place-items-center bg-black/60 p-4 backdrop-blur-sm" role="presentation">
      <section className="w-full max-w-md rounded-xl border border-white/10 bg-card p-5 shadow-2xl ring-1 ring-white/10" aria-labelledby="idle-lock-title" role="dialog" aria-modal="true">
        <div className="flex size-10 items-center justify-center rounded-md bg-accent text-accent-foreground"><ShieldCheck className="size-5" /></div>
        <h2 className="mt-4 text-lg font-semibold" id="idle-lock-title">Bestie sắp tự khóa</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">Không có hoạt động trong một lúc. Chọn tiếp tục trong 60 giây để giữ phiên này mở.</p>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button disabled={busy} onClick={() => void lockNow()} type="button" variant="outline"><LockKeyhole /> Khóa ngay</Button>
          <Button disabled={busy} onClick={() => void continueSession()} type="button">{busy ? <Loader2 className="animate-spin" /> : <ShieldCheck />} Vẫn ở đây</Button>
        </div>
      </section>
    </div>
  );
}