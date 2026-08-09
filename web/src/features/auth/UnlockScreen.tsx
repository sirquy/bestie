import { type FormEvent, type ReactElement, useEffect, useState } from "react";
import { KeyRound, Loader2, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PinCodeInput } from "@/components/ui/pin-code-input";
import { fetchJson, setCsrfToken } from "@/lib/api";

interface AuthStatus {
  configured: boolean;
  authenticated: boolean;
  csrfToken?: string;
}

interface AuthResult {
  csrfToken: string;
}

export function UnlockScreen({ onUnlocked }: { onUnlocked: () => void }): ReactElement {
  const [status, setStatus] = useState<AuthStatus>();
  const [pin, setPin] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void fetchJson<AuthStatus>("/api/auth/status")
      .then((nextStatus) => {
        if (nextStatus.authenticated && nextStatus.csrfToken) {
          setCsrfToken(nextStatus.csrfToken);
          onUnlocked();
          return;
        }
        setStatus(nextStatus);
      })
      .catch(() => setError("Không thể kiểm tra trạng thái mở khóa. Hãy tải lại trang."));
  }, [onUnlocked]);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!status || busy) return;
    if (!/^\d{6}$/.test(pin)) {
      setError("Mã mở khóa cần đúng 6 chữ số.");
      return;
    }
    if (!status.configured && pin !== confirmation) {
      setError("Hai mã chưa khớp. Nhập lại một lần nữa nhé.");
      return;
    }

    setBusy(true);
    setError("");
    try {
      const result = await fetchJson<AuthResult>(status.configured ? "/api/auth/login" : "/api/auth/setup", {
        method: "POST",
        body: JSON.stringify({ pin }),
      });
      setCsrfToken(result.csrfToken);
      onUnlocked();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Không thể mở khóa Bestie.");
    } finally {
      setBusy(false);
    }
  }

  const setup = status?.configured === false;
  return (
    <main className="flex min-h-screen items-center justify-center p-5">
      <section className="w-full max-w-sm rounded-lg border border-border bg-card/95 p-7 shadow-2xl backdrop-blur">
        <div className="mb-6 flex size-12 items-center justify-center rounded-md bg-primary text-primary-foreground"><ShieldCheck className="size-6" /></div>
        <p className="text-sm font-medium text-primary">Bestie trên máy này</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-normal">{setup ? "Tạo mã mở khóa" : "Mở khóa Bestie"}</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          {setup ? "Chọn một mã số riêng để bảo vệ chat, cài đặt và dữ liệu Bestie trên máy này." : "Nhập mã số để tiếp tục vào bảng điều khiển."}
        </p>
        <form className="mt-6 space-y-4" onSubmit={submit}>
          <label className="block text-sm font-medium" htmlFor="ui-unlock-pin">Mã mở khóa gồm 6 số</label>
          <PinCodeInput autoComplete={setup ? "new-password" : "current-password"} autoFocus id="unlock-pin" label="Mã mở khóa" onChange={setPin} value={pin} />
          {setup ? <><label className="block text-sm font-medium" htmlFor="ui-unlock-confirmation">Nhập lại mã gồm 6 số</label><PinCodeInput autoComplete="new-password" id="unlock-confirmation" label="Nhập lại mã" onChange={setConfirmation} value={confirmation} /></> : null}
          {error ? <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">{error}</p> : null}
          <Button className="w-full" disabled={!status || busy} size="lg" type="submit">
            {busy ? <Loader2 className="animate-spin" /> : <KeyRound />}{setup ? "Lưu và mở Bestie" : "Mở khóa"}
          </Button>
        </form>
        <p className="mt-5 text-xs leading-5 text-muted-foreground">Quên mã? Chạy <code>bestie ui auth reset</code> trong Terminal trên chính máy này.</p>
      </section>
    </main>
  );
}