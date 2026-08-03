import type { ReactElement, ReactNode } from "react";
import { createContext, useContext, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface ConfirmOptions {
  title?: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "default" | "destructive";
}

interface PromptOptions extends ConfirmOptions {
  defaultValue?: string;
  placeholder?: string;
}

type DialogState =
  | { type: "confirm"; options: ConfirmOptions; resolve: (value: boolean) => void }
  | { type: "prompt"; options: PromptOptions; value: string; resolve: (value: string | null) => void }
  | { type: "alert"; options: ConfirmOptions; resolve: () => void };

interface DialogContextValue {
  alert: (options: string | ConfirmOptions) => Promise<void>;
  confirm: (options: string | ConfirmOptions) => Promise<boolean>;
  prompt: (options: string | PromptOptions) => Promise<string | null>;
}

const DialogContext = createContext<DialogContextValue | null>(null);
let globalDialogs: DialogContextValue | null = null;

export function DialogProvider({ children }: { children: ReactNode }): ReactElement {
  const [dialog, setDialog] = useState<DialogState | null>(null);

  const api = useMemo<DialogContextValue>(() => ({
    alert: (options) => new Promise<void>((resolve) => setDialog({ type: "alert", options: normalizeOptions(options), resolve })),
    confirm: (options) => new Promise<boolean>((resolve) => setDialog({ type: "confirm", options: normalizeOptions(options), resolve })),
    prompt: (options) => new Promise<string | null>((resolve) => {
      const normalized = normalizePromptOptions(options);
      setDialog({ type: "prompt", options: normalized, value: normalized.defaultValue ?? "", resolve });
    }),
  }), []);

  globalDialogs = api;

  function closeWith(value: boolean | string | null | undefined): void {
    if (!dialog) return;
    if (dialog.type === "confirm") dialog.resolve(Boolean(value));
    if (dialog.type === "prompt") dialog.resolve(typeof value === "string" ? value : null);
    if (dialog.type === "alert") dialog.resolve();
    setDialog(null);
  }

  return (
    <DialogContext.Provider value={api}>
      {children}
      {dialog ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm" role="presentation" onMouseDown={() => closeWith(dialog.type === "alert" ? undefined : false)}>
          <div className="w-full max-w-md rounded-3xl border border-white/10 bg-card p-5 shadow-2xl ring-1 ring-white/10" role="dialog" aria-modal="true" aria-labelledby="bestie-dialog-title" onMouseDown={(event) => event.stopPropagation()}>
            <h2 id="bestie-dialog-title" className="text-lg font-semibold">{dialog.options.title ?? (dialog.type === "prompt" ? "Cần nhập thông tin" : dialog.type === "alert" ? "Thông báo" : "Xác nhận thao tác")}</h2>
            <p className="mt-2 text-sm text-muted-foreground">{dialog.options.description}</p>
            {dialog.type === "prompt" ? <Input className="mt-4" autoFocus value={dialog.value} placeholder={dialog.options.placeholder} onChange={(event) => setDialog({ ...dialog, value: event.target.value })} onKeyDown={(event) => { if (event.key === "Enter") closeWith(dialog.value); if (event.key === "Escape") closeWith(null); }} /> : null}
            <div className="mt-5 flex justify-end gap-2">
              {dialog.type !== "alert" ? <Button variant="outline" onClick={() => closeWith(dialog.type === "prompt" ? null : false)}>{dialog.options.cancelLabel ?? "Huỷ"}</Button> : null}
              <Button variant={dialog.options.tone === "destructive" ? "destructive" : "default"} onClick={() => closeWith(dialog.type === "prompt" ? dialog.value : true)}>{dialog.options.confirmLabel ?? (dialog.type === "alert" ? "Đã hiểu" : "Xác nhận")}</Button>
            </div>
          </div>
        </div>
      ) : null}
    </DialogContext.Provider>
  );
}

export function useDialogs(): DialogContextValue {
  const context = useContext(DialogContext);
  if (!context) throw new Error("useDialogs must be used inside DialogProvider");
  return context;
}

export function confirmDialog(options: string | ConfirmOptions): Promise<boolean> {
  if (!globalDialogs) return Promise.resolve(false);
  return globalDialogs.confirm(options);
}

export function promptDialog(options: string | PromptOptions): Promise<string | null> {
  if (!globalDialogs) return Promise.resolve(null);
  return globalDialogs.prompt(options);
}

export function alertDialog(options: string | ConfirmOptions): Promise<void> {
  if (!globalDialogs) return Promise.resolve();
  return globalDialogs.alert(options);
}

function normalizeOptions(options: string | ConfirmOptions): ConfirmOptions {
  return typeof options === "string" ? { description: options } : options;
}

function normalizePromptOptions(options: string | PromptOptions): PromptOptions {
  return typeof options === "string" ? { description: options } : options;
}
