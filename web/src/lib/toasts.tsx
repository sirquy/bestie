import type { ReactElement, ReactNode } from "react";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";

import { Button } from "@/components/ui/button";

type ToastTone = "success" | "error" | "info";

interface ToastOptions {
  title: string;
  description?: string;
  tone?: ToastTone;
  durationMs?: number;
}

interface ToastItem extends Required<Pick<ToastOptions, "title" | "tone">> {
  id: number;
  description?: string;
  durationMs: number;
}

interface ToastContextValue {
  show: (options: ToastOptions) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);
let globalToasts: ToastContextValue | null = null;
let nextToastId = 1;
let lastToast: { signature: string; shownAt: number } | null = null;

export function ToastProvider({ children }: { children: ReactNode }): ReactElement {
  const [items, setItems] = useState<ToastItem[]>([]);

  const api = useMemo<ToastContextValue>(() => ({
    show: (options) => {
      const signature = `${options.tone ?? "info"}:${options.title}:${options.description ?? ""}`;
      const now = Date.now();
      if (lastToast?.signature === signature && now - lastToast.shownAt < 750) return;
      lastToast = { signature, shownAt: now };
      const item: ToastItem = {
        id: nextToastId++,
        title: options.title,
        description: options.description,
        tone: options.tone ?? "info",
        durationMs: options.durationMs ?? 4200,
      };
      setItems((current) => [...current.slice(-3), item]);
    },
  }), []);

  globalToasts = api;

  function dismiss(id: number): void {
    setItems((current) => current.filter((item) => item.id !== id));
  }

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed right-3 top-3 z-[80] grid w-[calc(100vw-1.5rem)] max-w-sm gap-2 sm:right-4 sm:top-4" aria-live="polite" aria-relevant="additions removals">
        {items.map((item) => <ToastCard key={item.id} item={item} onDismiss={dismiss} />)}
      </div>
    </ToastContext.Provider>
  );
}

export function useToasts(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToasts must be used inside ToastProvider");
  return context;
}

export function showToast(options: ToastOptions): void {
  globalToasts?.show(options);
}

export function ToastEffect({ title, description, tone = "info", onShown }: ToastOptions & { onShown?: () => void }): null {
  useEffect(() => {
    showToast({ title, description, tone });
    onShown?.();
  }, [description, title, tone]);
  return null;
}

function ToastCard({ item, onDismiss }: { item: ToastItem; onDismiss: (id: number) => void }): ReactElement {
  useEffect(() => {
    const timer = window.setTimeout(() => onDismiss(item.id), item.durationMs);
    return () => window.clearTimeout(timer);
  }, [item.durationMs, item.id, onDismiss]);

  const Icon = item.tone === "success" ? CheckCircle2 : item.tone === "error" ? AlertCircle : Info;
  const toneClass = item.tone === "success" ? "border-primary/35 bg-primary/15" : item.tone === "error" ? "border-destructive/40 bg-destructive/15" : "border-accent/35 bg-accent/15";

  return (
    <div className={`pointer-events-auto rounded-2xl border p-3 text-sm shadow-2xl backdrop-blur-xl ${toneClass}`} role={item.tone === "error" ? "alert" : "status"}>
      <div className="flex items-start gap-3">
        <Icon className="mt-0.5 size-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold leading-5">{item.title}</p>
          {item.description ? <p className="mt-1 whitespace-pre-wrap leading-5 text-muted-foreground">{item.description}</p> : null}
        </div>
        <Button type="button" variant="ghost" size="icon" className="-mr-1 -mt-1 size-7 shrink-0" onClick={() => onDismiss(item.id)} aria-label={"\u0110\u00f3ng th\u00f4ng b\u00e1o"}><X className="size-4" /></Button>
      </div>
    </div>
  );
}
