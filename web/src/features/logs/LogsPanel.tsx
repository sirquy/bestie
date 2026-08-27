import type { ReactElement } from "react";
import { useMemo, useState } from "react";
import { AlertCircle, RefreshCw, Search } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatError } from "@/lib/api";
import type { LogsSummary } from "./types";

export function LogsPanel({ data, loading, onRefresh }: { data?: LogsSummary; loading: boolean; onRefresh: () => void }): ReactElement {
  const [query, setQuery] = useState("");
  const lines = useMemo(() => (data?.lines ?? []).filter((line) => line.toLowerCase().includes(query.trim().toLowerCase())), [data?.lines, query]);
  return <div className="grid gap-4"><Card className="border-white/10 bg-background/35"><CardHeader className="flex-row items-start justify-between gap-4"><div><CardTitle>Runtime logs</CardTitle><CardDescription>Log cục bộ đã được che secrets. Hiển thị {data?.count ?? 0} dòng gần nhất.</CardDescription></div><Button variant="outline" size="sm" disabled={loading} onClick={onRefresh}><RefreshCw className={loading ? "animate-spin" : ""} /> Tải lại</Button></CardHeader><CardContent className="grid gap-3"><div className="relative"><Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" /><Input className="pl-9" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Lọc theo event, lỗi, provider..." /></div><pre className="max-h-[65vh] overflow-auto rounded-xl border border-white/10 bg-black/30 p-4 text-xs leading-6 text-muted-foreground">{lines.length ? lines.join("\n") : "Chưa có log khớp bộ lọc."}</pre></CardContent></Card></div>;
}

export function LogsPanelError({ error }: { error: unknown }): ReactElement { return <Alert variant="destructive"><AlertCircle className="size-4" /><AlertTitle>Không tải được logs</AlertTitle><AlertDescription>{formatError(error)}</AlertDescription></Alert>; }
