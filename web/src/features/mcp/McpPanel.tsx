import type { ReactElement } from "react";
import { useState } from "react";
import { AlertCircle, KeyRound, ListTree, Plug, RefreshCw, Server, ShieldCheck, Wrench } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { fetchJson, formatError } from "@/lib/api";
import type { McpServer, McpSummary } from "./types";

interface McpPanelProps {
  data?: McpSummary;
  loading: boolean;
  onData: (data: McpSummary) => void;
  onLoading: (loading: boolean) => void;
}

export function McpPanel({ data, loading, onData, onLoading }: McpPanelProps): ReactElement {
  const [actionError, setActionError] = useState<string | null>(null);

  async function reload(): Promise<void> {
    setActionError(null);
    onLoading(true);
    try {
      onData(await fetchJson<McpSummary>("/api/mcp"));
    } catch (error: unknown) {
      setActionError(formatError(error));
    } finally {
      onLoading(false);
    }
  }

  if (!data) {
    return (
      <Alert className="border-accent/40 bg-accent/10">
        <Plug className="size-4" />
        <AlertTitle>Đang tải tiện ích mở rộng</AlertTitle>
        <AlertDescription>Đang tải tiện ích mở rộng đã kết nối.</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="grid gap-4">
      {actionError ? <McpError message={actionError} /> : null}

      <div className="grid gap-3 md:grid-cols-4" data-mcp-summary>
        <Metric label="Đã bật" value={String(data.counts.enabled)} tone="good" />
        <Metric label="Đã tắt" value={String(data.counts.disabled)} tone={data.counts.disabled ? "warn" : "neutral"} />
        <Metric label="Công cụ" value={String(data.counts.tools)} />
        <Metric label="Máy chủ" value={String(data.counts.total)} />
      </div>

      <Card className="border-white/10 bg-background/35">
        <CardHeader className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2"><Server className="size-5" /> Connected extensions</CardTitle>
            <CardDescription>Xem tiện ích đã kết nối, công cụ khả dụng và trạng thái đăng nhập. Giá trị bí mật luôn được ẩn.</CardDescription>
          </div>
          <Button variant="outline" onClick={() => void reload()} disabled={loading}><RefreshCw className={loading ? "animate-spin" : ""} /> Tải lại</Button>
        </CardHeader>
        <CardContent className="grid gap-4">
          {data.servers.length ? data.servers.map((server) => <McpServerCard key={server.name} server={server} />) : <p className="rounded-2xl border border-dashed border-white/10 bg-background/25 p-4 text-sm text-muted-foreground">Chưa kết nối tiện ích mở rộng.</p>}
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <McpToolsSummary servers={data.servers} />
        <McpAuthSummary servers={data.servers} />
      </div>
    </div>
  );
}

export function McpPanelError({ error }: { error: unknown }): ReactElement {
  return <McpError message={formatError(error)} />;
}

function McpError({ message }: { message: string }): ReactElement {
  return (
    <Alert variant="destructive">
      <AlertCircle className="size-4" />
      <AlertTitle>Không tải được tiện ích mở rộng</AlertTitle>
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}

function McpServerCard({ server }: { server: McpServer }): ReactElement {
  return (
    <article className="rounded-2xl border border-white/10 bg-card/60 p-4 text-sm" data-mcp-server={server.name}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-lg font-semibold">{server.name}</p>
          <p className="text-muted-foreground">Kết nối {server.transport}</p>
        </div>
        <Badge variant={server.enabled ? "secondary" : "destructive"}>{server.enabled ? "đã bật" : "đã tắt"}</Badge>
      </div>
      <Separator className="my-4" />
      <div className="grid gap-3 md:grid-cols-3">
        <ConfigFlag label="Khởi động" value={server.commandConfigured ? "sẵn sàng" : "chưa đặt"} />
        <ConfigFlag label="Tuỳ chọn" value={String(server.argCount)} />
        <ConfigFlag label="URL" value={server.urlConfigured ? "sẵn sàng" : "chưa đặt"} />
      </div>
      <ChipSection label="Danh mục" values={server.tools.categories} attr="data-mcp-categories" />
      <ChipSection label="Công cụ" values={server.tools.names} attr="data-mcp-tools" />
    </article>
  );
}

function McpToolsSummary({ servers }: { servers: McpServer[] }): ReactElement {
  const toolNames = servers.flatMap((server) => server.tools.names.map((name) => `${server.name}: ${name}`));
  return (
    <Card className="border-white/10 bg-background/35">
      <CardHeader><CardTitle className="flex items-center gap-2"><Wrench className="size-5" /> Công cụ</CardTitle><CardDescription>Tên công cụ do các tiện ích mở rộng sẵn sàng cung cấp.</CardDescription></CardHeader>
      <CardContent className="grid gap-2">{toolNames.length ? toolNames.map((name) => <Badge key={name} variant="outline" className="w-fit max-w-full break-all">{name}</Badge>) : <p className="text-sm text-muted-foreground">Chưa có thao tác từ tiện ích mở rộng.</p>}</CardContent>
    </Card>
  );
}

function McpAuthSummary({ servers }: { servers: McpServer[] }): ReactElement {
  const authServers = servers.filter((server) => server.auth || server.envKeys.length || server.headerEnvNames.length || server.headerNames.length);
  return (
    <Card className="border-white/10 bg-background/35">
      <CardHeader><CardTitle className="flex items-center gap-2"><KeyRound className="size-5" /> Auth</CardTitle><CardDescription>Env var names and header names only; values stay private.</CardDescription></CardHeader>
      <CardContent className="grid gap-3">
        {authServers.length ? authServers.map((server) => <AuthServer key={server.name} server={server} />) : <p className="text-sm text-muted-foreground">Chưa có thông tin đăng nhập tiện ích mở rộng.</p>}
      </CardContent>
    </Card>
  );
}

function AuthServer({ server }: { server: McpServer }): ReactElement {
  return (
    <div className="rounded-2xl border border-white/10 bg-card/60 p-4 text-sm">
      <p className="font-semibold">{server.name}</p>
      <ChipSection label="Tên thông tin xác thực" values={server.envKeys} />
      <ChipSection label="Tên header" values={server.headerNames} />
      <ChipSection label="Tên header bí mật" values={server.headerEnvNames} />
      {server.auth ? (
        <div className="mt-3 rounded-xl border border-white/10 bg-background/40 p-3">
          <p><span className="text-muted-foreground">Sign-in credential:</span> {server.auth.envVar}</p>
          {server.auth.headerName ? <p><span className="text-muted-foreground">Header:</span> {server.auth.headerName}</p> : null}
          <ChipSection label="Phạm vi" values={server.auth.scopes} />
        </div>
      ) : null}
    </div>
  );
}

function ConfigFlag({ label, value }: { label: string; value: string }): ReactElement {
  return <div className="rounded-xl border border-white/10 bg-background/40 p-3"><p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{label}</p><p className="mt-1 font-medium">{value}</p></div>;
}

function ChipSection({ label, values, attr }: { label: string; values: string[]; attr?: string }): ReactElement {
  return (
    <div className="mt-3">
      <p className="mb-2 text-xs uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      <div className="flex flex-wrap gap-2" {...(attr ? { [attr]: true } : {})}>{values.length ? values.map((value) => <Badge key={value} variant="outline" className="max-w-full break-all">{value}</Badge>) : <span className="text-sm text-muted-foreground">-</span>}</div>
    </div>
  );
}

function Metric({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "good" | "warn" | "neutral" }): ReactElement {
  const className = tone === "good" ? "text-primary" : tone === "warn" ? "text-accent" : "text-foreground";
  return <Card className="border-white/10 bg-background/35"><CardContent className="p-4"><p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{label}</p><p className={`mt-2 text-2xl font-semibold ${className}`}>{value}</p></CardContent></Card>;
}

