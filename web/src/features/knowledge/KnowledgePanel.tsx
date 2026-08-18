import type { FormEvent, ReactElement } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ForceGraph3DInstance, LinkObject, NodeObject } from "3d-force-graph";
import { AlertCircle, Check, Database, GitBranch, Link2Off, Merge, RefreshCw, Search, ShieldAlert, Sparkles, Trash2, X } from "lucide-react";
import type * as THREE from "three";
import type SpriteText from "three-spritetext";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { fetchJson, formatError } from "@/lib/api";
import { confirmDialog } from "@/lib/dialogs";
import { ToastEffect } from "@/lib/toasts";
import type { KnowledgeEntity, KnowledgeGraphAction, KnowledgeGraphDisplayCount, KnowledgeGraphSummary, KnowledgeRelation, PendingKnowledgeItem } from "./types";

interface KnowledgePanelProps {
  data?: KnowledgeGraphSummary;
  loading: boolean;
  onData: (data: KnowledgeGraphSummary) => void;
  onLoading: (loading: boolean) => void;
}

interface RelationEditDraft {
  relationId: string;
  confidence: string;
  evidence: string;
  scope: "" | "core" | "project" | "session";
  sensitivity: "" | "normal" | "sensitive";
}

const KNOWLEDGE_GRAPH_DISPLAY_LIMITS = [100, 250, 500] as const;

export function KnowledgePanel({ data, loading, onData, onLoading }: KnowledgePanelProps): ReactElement {
  const [query, setQuery] = useState("");
  const [displayLimit, setDisplayLimit] = useState(250);
  const [inventoryView, setInventoryView] = useState<"entities" | "relations">("entities");
  const [mergePrimaryId, setMergePrimaryId] = useState("");
  const [mergeDuplicateId, setMergeDuplicateId] = useState("");
  const [reason, setReason] = useState("");
  const [relationDraft, setRelationDraft] = useState<RelationEditDraft>({ relationId: "", confidence: "", evidence: "", scope: "", sensitivity: "" });
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const entityOptions = useMemo(() => data?.entities ?? [], [data]);
  const relationOptions = useMemo(() => data?.relations ?? [], [data]);

  async function runRequest(request: () => Promise<KnowledgeGraphSummary>, success?: string): Promise<void> {
    setActionError(null);
    setActionMessage(null);
    onLoading(true);
    try {
      const nextData = await request();
      onData(nextData);
      setDisplayLimit(nextData.display.limit);
      setActionMessage(nextData.message ?? success ?? null);
    } catch (error: unknown) {
      setActionError(formatError(error));
    } finally {
      onLoading(false);
    }
  }

  async function reload(): Promise<void> {
    setQuery("");
    await runRequest(() => fetchJson<KnowledgeGraphSummary>(knowledgeGraphPath(undefined, displayLimit)));
  }

  async function search(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const trimmed = query.trim();
    await runRequest(() => fetchJson<KnowledgeGraphSummary>(knowledgeGraphPath(trimmed || undefined, displayLimit)));
  }

  async function changeDisplayLimit(nextLimit: number): Promise<void> {
    setDisplayLimit(nextLimit);
    await runRequest(() => fetchJson<KnowledgeGraphSummary>(knowledgeGraphPath(query.trim() || undefined, nextLimit)));
  }

  async function postAction(body: Record<string, unknown>, confirmText: string): Promise<void> {
    if (!await confirmDialog(confirmText)) return;
    await runRequest(() => fetchJson<KnowledgeGraphSummary>("/api/knowledge-graph/action", { method: "POST", body: JSON.stringify({ ...body, confirm: true, limit: displayLimit }) }));
  }

  async function runPendingAction(action: KnowledgeGraphAction, item: PendingKnowledgeItem): Promise<void> {
    const label = action === "approve_pending" ? "Duyệt" : action === "sanitize_pending" ? "Làm sạch" : "Từ chối";
    await postAction({ action, id: item.id }, `${label} mục tri thức đang chờ #${item.id}?`);
  }

  async function mergeEntities(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const primaryId = Number(mergePrimaryId);
    const duplicateId = Number(mergeDuplicateId);
    if (!primaryId || !duplicateId || primaryId === duplicateId) {
      setActionError("Chọn hai thực thể khác nhau để gộp.");
      return;
    }
    await postAction({ action: "merge_entity", primaryId, duplicateId, reason }, `Gộp thực thể #${duplicateId} vào #${primaryId}? Thao tác này có thể cần phê duyệt.`);
  }

  async function updateRelation(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const id = Number(relationDraft.relationId);
    if (!id) {
      setActionError("Chọn một quan hệ để cập nhật.");
      return;
    }
    const body: Record<string, unknown> = { action: "update_relation", id, reason };
    if (relationDraft.confidence.trim()) body.confidence = Number(relationDraft.confidence);
    if (relationDraft.evidence.trim()) body.evidence = relationDraft.evidence.trim();
    if (relationDraft.scope) body.scope = relationDraft.scope;
    if (relationDraft.sensitivity) body.sensitivity = relationDraft.sensitivity;
    if (Object.keys(body).length <= 3) {
      setActionError("Nhập độ tin cậy, bằng chứng, phạm vi hoặc độ nhạy trước khi cập nhật.");
      return;
    }
    await postAction(body, `Cập nhật quan hệ #${id}? Thao tác này có thể cần phê duyệt.`);
  }

  if (!data) {
    return (
      <Alert className="border-accent/40 bg-accent/10">
        <GitBranch className="size-4" />
        <AlertTitle>Đang tải bản đồ tri thức</AlertTitle>
        <AlertDescription>Đang đọc thực thể, quan hệ, mục đang chờ và dữ liệu đánh giá tin cậy trên máy.</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="grid gap-4">
      {actionError ? <ToastEffect title="Không thể cập nhật tri thức" description={actionError} tone="error" onShown={() => setActionError(null)} /> : null}
      {actionMessage ? <ToastEffect title="Tri thức đã cập nhật" description={actionMessage} tone="success" onShown={() => setActionMessage(null)} /> : null}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5" data-knowledge-summary="true">
        <KnowledgeMetric label="Thực thể" value={String(data.counts.entities)} />
        <KnowledgeMetric label="Quan hệ" value={String(data.counts.relations)} />
        <KnowledgeMetric label="Đang chờ" value={String(data.counts.pending)} tone={data.counts.pending ? "warn" : "good"} />
        <KnowledgeMetric label="Mức tin tưởng" value={formatTrust(data.trust)} />
        <KnowledgeMetric label="Trạng thái" value={data.state.paused ? "đang tạm dừng" : "đang hoạt động"} tone={data.state.paused ? "warn" : "good"} />
      </div>

      <Card className="overflow-hidden border-white/10 bg-background/35" id="knowledge-cytoscape">
        <CardHeader className="gap-4 border-b border-white/10 bg-gradient-to-r from-white/[0.06] via-white/[0.02] to-transparent">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
            <div className="min-w-0">
              <CardTitle className="flex items-center gap-2 text-xl"><GitBranch className="size-5" /> 3D Tri thức Map</CardTitle>
              <CardDescription className="mt-2 max-w-3xl">Không gian 3D cho thực thể, liên kết quan hệ, độ tin cậy, phạm vi, độ nhạy và mức tin tưởng.</CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={data.database.exists ? "secondary" : "destructive"}>{data.database.exists ? "tri thức sẵn sàng" : "chưa có tri thức"}</Badge>
              <Badge variant={data.state.paused ? "destructive" : "outline"}>{data.state.paused ? "đang tạm dừng" : "đang hoạt động"}</Badge>
              <Label className="sr-only" htmlFor="knowledge-display-limit">Số mục hiển thị</Label>
              <Select id="knowledge-display-limit" className="w-28" value={displayLimit} disabled={loading} onChange={(event) => void changeDisplayLimit(Number(event.target.value))} data-knowledge-display-limit>
                {KNOWLEDGE_GRAPH_DISPLAY_LIMITS.map((limit) => <option key={limit} value={limit}>{limit} mục</option>)}
              </Select>
              <Button variant="outline" onClick={() => void reload()} disabled={loading}><RefreshCw className={loading ? "animate-spin" : ""} /> Tải lại</Button>
            </div>
          </div>
          <form className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_auto]" onSubmit={(event) => void search(event)}>
            <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm thực thể, quan hệ và tri thức đang chờ" />
            <Button type="submit" disabled={loading}><Search /> Tìm trên bản đồ</Button>
          </form>
          {data.query ? <p className="text-sm text-muted-foreground">Từ khoá tìm kiếm: <span className="text-foreground">{data.query}</span></p> : null}
          <KnowledgeGraphDisplayNotice display={data.display} search={Boolean(data.query)} />
        </CardHeader>
        <CardContent className="grid gap-4 p-3 md:p-4">
          <KnowledgeMap3D entities={data.entities} relations={data.relations} display={data.display} />
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,0.95fr)_minmax(24rem,0.7fr)]">
        <Card className="border-white/10 bg-background/35">
          <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2"><Database className="size-5" /> Tri thức inventory</CardTitle>
              <CardDescription>Xem từng loại một để dễ tập trung kiểm tra.</CardDescription>
            </div>
            <div className="flex rounded-2xl border border-white/10 bg-background/40 p-1 text-sm">
              <button type="button" className={`rounded-xl px-3 py-1.5 transition ${inventoryView === "entities" ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"}`} onClick={() => setInventoryView("entities")}>Thực thể <span className="ml-1 text-xs opacity-70">{formatDisplayCount(data.display.entities)}</span></button>
              <button type="button" className={`rounded-xl px-3 py-1.5 transition ${inventoryView === "relations" ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"}`} onClick={() => setInventoryView("relations")}>Quan hệ <span className="ml-1 text-xs opacity-70">{formatDisplayCount(data.display.relations)}</span></button>
            </div>
          </CardHeader>
          <CardContent className="grid gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-white/10 bg-card/40 px-3 py-2 text-xs text-muted-foreground">
              <span>{inventoryView === "entities" ? "Tên thực thể, loại, phạm vi, độ tin cậy và mức tin tưởng." : "Đường liên kết, loại quan hệ, bằng chứng, độ tin cậy và mức tin tưởng."}</span>
              <Badge variant="outline">{formatDisplayCount(inventoryView === "entities" ? data.display.entities : data.display.relations)} đang hiển thị</Badge>
            </div>
            <div className="no-scrollbar grid max-h-[38rem] gap-2 overflow-auto pr-1">
              {inventoryView === "entities"
                ? data.entities.length ? data.entities.map((entity) => <EntityRow key={entity.id} entity={entity} loading={loading} onForget={(id) => postAction({ action: "forget_entity", id, reason }, `Quên thực thể #${id}? Thao tác này có thể cần phê duyệt.`)} />) : <EmptyText>Không tìm thấy thực thể.</EmptyText>
                : data.relations.length ? data.relations.map((relation) => <RelationRow key={relation.id} relation={relation} loading={loading} onForget={(id) => postAction({ action: "forget_relation", id, reason }, `Quên quan hệ #${id}? Thao tác này có thể cần phê duyệt.`)} />) : <EmptyText>Không tìm thấy quan hệ.</EmptyText>}
            </div>
          </CardContent>
        </Card>

        <div className="grid content-start gap-4">
          <Card className="border-white/10 bg-background/35">
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><ShieldAlert className="size-5" /> Đang chờ duyệt</CardTitle>
              <CardDescription>Duyệt, từ chối hoặc làm sạch tri thức đã trích xuất trước khi lưu vào bộ nhớ.</CardDescription>
            </CardHeader>
            <CardContent className="no-scrollbar grid max-h-80 gap-3 overflow-auto pr-1">
              {data.pending.length ? data.pending.map((item) => <PendingRow key={item.id} item={item} loading={loading} onAction={runPendingAction} />) : <EmptyText>Không có tri thức đang chờ.</EmptyText>}
            </CardContent>
          </Card>

          <Card className="border-white/10 bg-background/35">
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Sparkles className="size-5" /> Thao tác bản đồ</CardTitle>
              <CardDescription>Dọn dẹp và chỉnh quan hệ sau khi bạn xác nhận.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="knowledge-reason">Lý do</Label>
                <Textarea id="knowledge-reason" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Lý do tuỳ chọn để lưu lịch sử" rows={2} />
              </div>
              <form className="grid gap-3" onSubmit={(event) => void mergeEntities(event)}>
                <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
                  <EntitySelect id="knowledge-primary-entity" label="Thực thể chính" value={mergePrimaryId} onChange={setMergePrimaryId} entities={entityOptions} />
                  <EntitySelect id="knowledge-duplicate-entity" label="Thực thể trùng" value={mergeDuplicateId} onChange={setMergeDuplicateId} entities={entityOptions} />
                </div>
                <Button type="submit" variant="outline" disabled={loading || entityOptions.length < 2} data-knowledge-graph-action="merge_entity"><Merge /> Gộp thực thể</Button>
              </form>
              <Separator />
              <form className="grid gap-3" onSubmit={(event) => void updateRelation(event)}>
                <div className="grid gap-2">
                  <Label htmlFor="knowledge-relation-select">Quan hệ</Label>
                  <Select id="knowledge-relation-select" value={relationDraft.relationId} onChange={(event) => setRelationDraft((current) => ({ ...current, relationId: event.target.value }))} data-knowledge-select="relation">
                    <option value="">Chọn quan hệ</option>
                    {relationOptions.map((relation) => <option key={relation.id} value={relation.id}>#{relation.id} {relation.sourceName} ? {relation.targetName}</option>)}
                  </Select>
                </div>
                <div className="grid gap-2 md:grid-cols-3 xl:grid-cols-1 2xl:grid-cols-3">
                  <Input value={relationDraft.confidence} onChange={(event) => setRelationDraft((current) => ({ ...current, confidence: event.target.value }))} placeholder="độ tin cậy 0-1" inputMode="decimal" />
                  <Select value={relationDraft.scope} onChange={(event) => setRelationDraft((current) => ({ ...current, scope: event.target.value as RelationEditDraft["scope"] }))}>
                    <option value="">Scope</option><option value="core">core</option><option value="project">project</option><option value="session">session</option>
                  </Select>
                  <Select value={relationDraft.sensitivity} onChange={(event) => setRelationDraft((current) => ({ ...current, sensitivity: event.target.value as RelationEditDraft["sensitivity"] }))}>
                    <option value="">Sensitivity</option><option value="normal">normal</option><option value="sensitive">sensitive</option>
                  </Select>
                </div>
                <Textarea value={relationDraft.evidence} onChange={(event) => setRelationDraft((current) => ({ ...current, evidence: event.target.value }))} placeholder="Bằng chứng cập nhật" rows={2} />
                <Button type="submit" variant="outline" disabled={loading || !relationOptions.length} data-knowledge-graph-action="update_relation"><Check /> Cập nhật quan hệ</Button>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

export function KnowledgePanelError({ error }: { error: unknown }): ReactElement {
  return <KnowledgeError message={formatError(error)} />;
}

function KnowledgeError({ message }: { message: string }): ReactElement {
  return (
    <Alert variant="destructive">
      <AlertCircle className="size-4" />
      <AlertTitle>Không tải được bản đồ tri thức</AlertTitle>
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}

function KnowledgeGraphDisplayNotice({ display, search }: { display: KnowledgeGraphSummary["display"]; search: boolean }): ReactElement {
  const counts = [
    `thực thể ${formatDisplayCount(display.entities)}`,
    `quan hệ ${formatDisplayCount(display.relations)}`,
    `đang chờ ${formatDisplayCount(display.pending)}`,
  ];
  const truncated = [display.entities, display.relations, display.pending].some((item) => item.truncated);
  return (
    <div className={`flex flex-wrap items-center justify-between gap-2 rounded-2xl border px-3 py-2 text-xs ${truncated ? "border-accent/40 bg-accent/10 text-accent-foreground" : "border-white/10 bg-card/40 text-muted-foreground"}`} data-knowledge-display-summary>
      <span>{search ? "Kết quả đang hiển thị: " : "Đang render: "}{counts.join(" · ")}</span>
      <Badge variant="outline">tối đa {display.limit} mỗi nhóm</Badge>
      {truncated ? <span>Đã cắt bớt để giữ bản đồ 3D ổn định; tăng giới hạn nếu cần.</span> : null}
    </div>
  );
}

function KnowledgeMetric({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "good" | "warn" | "neutral" }): ReactElement {
  return (
    <Card className="border-white/10 bg-background/35">
      <CardContent className="p-4">
        <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
        <p className={tone === "good" ? "mt-2 text-2xl font-semibold text-primary" : tone === "warn" ? "mt-2 text-2xl font-semibold text-accent" : "mt-2 text-2xl font-semibold"}>{value}</p>
      </CardContent>
    </Card>
  );
}

interface KnowledgeGraphNode extends NodeObject {
  id: number;
  name: string;
  kind: string;
  sensitivity: string;
  scope: string;
  confidence: number;
  trust: string;
  color: string;
  size: number;
  entity: KnowledgeEntity;
}

interface KnowledgeGraphLink extends LinkObject<KnowledgeGraphNode> {
  id: number;
  source: number;
  target: number;
  relationType: string;
  evidence?: string;
  confidence: number;
  sensitivity: string;
  color: string;
  relation: KnowledgeRelation;
}

interface KnowledgeGraphData {
  nodes: KnowledgeGraphNode[];
  links: KnowledgeGraphLink[];
}

function KnowledgeMap3D({ entities, relations, display }: { entities: KnowledgeEntity[]; relations: KnowledgeRelation[]; display: KnowledgeGraphSummary["display"] }): ReactElement {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const graphRef = useRef<ForceGraph3DInstance<KnowledgeGraphNode, KnowledgeGraphLink> | null>(null);
  const graphData = useMemo(() => buildKnowledgeGraphData(entities, relations), [entities, relations]);
  const [selectedNode, setSelectedNode] = useState<KnowledgeGraphNode | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !graphData.nodes.length) return undefined;

    let disposed = false;
    let observer: ResizeObserver | undefined;
    let graph: ForceGraph3DInstance<KnowledgeGraphNode, KnowledgeGraphLink> | undefined;

    void Promise.all([import("3d-force-graph"), import("three"), import("three-spritetext")]).then(([forceGraphModule, threeModule, spriteTextModule]) => {
      if (disposed) return;
      const ForceGraph3D = forceGraphModule.default;
      const SpriteText = spriteTextModule.default;
      graph = new ForceGraph3D(container, { controlType: "orbit", rendererConfig: { antialias: true, alpha: true } }) as unknown as ForceGraph3DInstance<KnowledgeGraphNode, KnowledgeGraphLink>;
      graphRef.current = graph;
      graph
        .backgroundColor("rgba(0,0,0,0)")
        .showNavInfo(false)
        .width(container.clientWidth || 900)
        .height(container.clientHeight || 520)
        .graphData(graphData)
        .nodeLabel((node) => `${node.name}<br/>${formatKnowledgeKind(node.kind)} · ${formatPercent(node.confidence)} · ${formatKnowledgeTrustLabel(node.trust)}`)
        .nodeVal((node) => node.size)
        .nodeColor((node) => node.color)
        .nodeOpacity(0.92)
        .nodeResolution(24)
        .linkLabel((link) => `${link.relation.sourceName} ${link.relationType} ${link.relation.targetName}<br/>độ tin cậy ${formatPercent(link.confidence)}`)
        .linkColor((link) => link.color)
        .linkWidth((link) => 0.8 + link.confidence * 2.8)
        .linkOpacity(0.48)
        .linkDirectionalParticles((link) => Math.max(1, Math.round(link.confidence * 4)))
        .linkDirectionalParticleWidth((link) => 0.8 + link.confidence * 2)
        .linkDirectionalParticleSpeed((link) => 0.002 + link.confidence * 0.004)
        .nodeThreeObject((node) => createKnowledgeNodeObject(node, threeModule, SpriteText))
        .onNodeClick((node) => {
          setSelectedNode(node);
          const distance = 150;
          const distRatio = 1 + distance / Math.hypot(node.x ?? 1, node.y ?? 1, node.z ?? 1);
          graph?.cameraPosition({ x: (node.x ?? 0) * distRatio, y: (node.y ?? 0) * distRatio, z: (node.z ?? 0) * distRatio }, { x: node.x ?? 0, y: node.y ?? 0, z: node.z ?? 0 }, 900);
        })
        .onBackgroundClick(() => setSelectedNode(null));

      graph.d3Force("charge")?.strength(-180);
      graph.d3Force("link")?.distance((link: KnowledgeGraphLink) => 65 + (1 - link.confidence) * 70);
      graph.cameraPosition({ x: 0, y: 110, z: 460 }, { x: 0, y: 0, z: 0 }, 0);
      window.setTimeout(() => graph?.zoomToFit(700, 80), 250);

      observer = new ResizeObserver(([entry]) => {
        graph?.width(Math.floor(entry.contentRect.width));
        graph?.height(Math.floor(entry.contentRect.height));
      });
      observer.observe(container);
    });

    return () => {
      disposed = true;
      observer?.disconnect();
      graph?._destructor();
      graphRef.current = null;
    };
  }, [graphData]);

  if (!entities.length) return <EmptyText>Chưa có thực thể để vẽ bản đồ.</EmptyText>;

  return (
    <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-[radial-gradient(circle_at_50%_20%,rgba(166,244,172,0.15),transparent_18rem),radial-gradient(circle_at_80%_65%,rgba(255,181,91,0.10),transparent_18rem),linear-gradient(135deg,rgba(255,255,255,0.06),rgba(255,255,255,0.01))]" data-knowledge-map-3d>
      <div className="absolute left-4 top-4 z-10 flex flex-wrap gap-2 text-xs"><Badge variant="secondary">{formatDisplayCount(display.entities)} node</Badge><Badge variant="outline">{graphData.links.length} liên kết</Badge><Badge variant="outline">Bản đồ 3D tương tác</Badge></div>
      <div ref={containerRef} className="h-[28rem] w-full sm:h-[34rem] xl:h-[42rem]" data-knowledge-map-canvas />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-background/90 via-background/45 to-transparent p-4 pt-16">
        <div className="grid gap-2 text-xs text-muted-foreground md:grid-cols-3">
          <span>Kéo để xoay / cuộn để phóng to / bấm node để tập trung</span><span>Hạt chuyển động thể hiện hướng quan hệ và độ tin cậy</span><span>Đỏ = nhạy cảm, xanh lá/xanh dương = bộ nhớ phạm vi thường</span>
        </div>
      </div>
      {selectedNode ? <div className="absolute right-4 top-4 z-10 max-w-xs rounded-2xl border border-white/10 bg-background/85 p-3 text-xs shadow-xl backdrop-blur" data-knowledge-map-selected><p className="font-semibold text-foreground">{selectedNode.name}</p><p className="mt-1 text-muted-foreground">{formatKnowledgeKind(selectedNode.kind)} / {formatKnowledgeScope(selectedNode.scope)} / độ tin cậy {formatPercent(selectedNode.confidence)}</p><p className="mt-1 text-muted-foreground">mức tin tưởng {formatKnowledgeTrustLabel(selectedNode.trust)}</p></div> : null}
      <div className="hidden" data-knowledge-map-node={graphData.nodes[0]?.id ?? "none"} />
      <div className="hidden" data-knowledge-map-edge={graphData.links[0]?.id ?? "none"} />
    </div>
  );
}

function knowledgeGraphPath(query: string | undefined, limit: number): string {
  const params = new URLSearchParams({ limit: String(limit) });
  if (query) params.set("q", query);
  return `/api/knowledge-graph${query ? "/search" : ""}?${params.toString()}`;
}

function formatDisplayCount(display: KnowledgeGraphDisplayCount): string {
  if (display.total !== undefined) return `${display.shown}/${display.total}`;
  return display.truncated ? `${display.shown}+` : String(display.shown);
}

function buildKnowledgeGraphData(entities: KnowledgeEntity[], relations: KnowledgeRelation[]): KnowledgeGraphData {
  const entityIds = new Set(entities.map((entity) => entity.id));
  return {
    nodes: entities.map((entity) => ({
      id: entity.id,
      name: entity.canonicalName,
      kind: entity.kind,
      sensitivity: entity.sensitivity,
      scope: entity.scope,
      confidence: entity.confidence,
      trust: formatTrust(entity.trust),
      color: entity.sensitivity === "sensitive" ? "#f87171" : entity.scope === "project" ? "#a6f4ac" : entity.scope === "session" ? "#8bd3ff" : "#ffcf8a",
      size: 5 + Math.max(0.2, entity.confidence) * 10,
      entity,
    })),
    links: relations.filter((relation) => entityIds.has(relation.sourceEntityId) && entityIds.has(relation.targetEntityId)).map((relation) => ({
      id: relation.id,
      source: relation.sourceEntityId,
      target: relation.targetEntityId,
      relationType: relation.relationType,
      evidence: relation.evidence,
      confidence: relation.confidence,
      sensitivity: relation.sensitivity,
      color: relation.sensitivity === "sensitive" ? "rgba(248,113,113,0.85)" : "rgba(166,244,172,0.72)",
      relation,
    })),
  };
}

function createKnowledgeNodeObject(node: KnowledgeGraphNode, three: typeof THREE, SpriteTextClass: typeof SpriteText): THREE.Group {
  const group = new three.Group();
  const geometry = new three.SphereGeometry(node.size, 24, 24);
  const material = new three.MeshLambertMaterial({ color: node.color, emissive: node.color, emissiveIntensity: 0.22, transparent: true, opacity: 0.94 });
  const sphere = new three.Mesh(geometry, material);
  const halo = new three.Mesh(new three.SphereGeometry(node.size * 1.75, 24, 24), new three.MeshBasicMaterial({ color: node.color, transparent: true, opacity: 0.08, depthWrite: false }));
  const label = new SpriteTextClass(node.name, 4.2, "#eef6ed");
  label.backgroundColor = "rgba(3,7,18,0.58)";
  label.borderColor = "rgba(255,255,255,0.18)";
  label.borderWidth = 0.4;
  label.borderRadius = 4;
  label.padding = [3, 2];
  label.position.set(0, node.size + 8, 0);
  group.add(halo, sphere, label);
  return group;
}

function EntityRow({ entity, loading, onForget }: { entity: KnowledgeEntity; loading: boolean; onForget: (id: number) => Promise<void> }): ReactElement {
  return (
    <div className="knowledge-row rounded-2xl border border-white/10 bg-card/55 p-3 text-sm transition hover:border-primary/30 hover:bg-card/75">
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
        <div className="min-w-0">
          <p className="truncate font-semibold">#{entity.id} {entity.canonicalName}</p>
          <p className="mt-1 truncate text-xs text-muted-foreground">{formatKnowledgeKind(entity.kind)}{entity.aliases.length ? ` · ${entity.aliases.slice(0, 3).join(", ")}${entity.aliases.length > 3 ? "…" : ""}` : ""}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 md:justify-end"><Badge variant="outline">{formatKnowledgeScope(entity.scope)}</Badge><Badge variant={entity.sensitivity === "sensitive" ? "destructive" : "secondary"}>{formatSensitivity(entity.sensitivity)}</Badge><Badge variant="outline">{formatPercent(entity.confidence)}</Badge><Button size="sm" variant="ghost" onClick={() => void onForget(entity.id)} disabled={loading} data-knowledge-action="forget_entity"><Trash2 /> Quên</Button></div>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">độ tin cậy {formatTrust(entity.trust)} · cập nhật {formatDate(entity.updatedAt)}</p>
    </div>
  );
}

function RelationRow({ relation, loading, onForget }: { relation: KnowledgeRelation; loading: boolean; onForget: (id: number) => Promise<void> }): ReactElement {
  return (
    <div className="knowledge-row rounded-2xl border border-white/10 bg-card/55 p-3 text-sm transition hover:border-primary/30 hover:bg-card/75">
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
        <div className="min-w-0">
          <p className="truncate font-semibold">#{relation.id} {relation.sourceName} <span className="text-muted-foreground">→ {relation.targetName}</span></p>
          <p className="mt-1 truncate text-xs text-muted-foreground"><span className="text-foreground/80">{formatRelationType(relation.relationType)}</span>{relation.evidence ? ` · ${relation.evidence}` : " · Chưa có nội dung bằng chứng."}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 md:justify-end"><Badge variant="outline">{formatKnowledgeScope(relation.scope)}</Badge><Badge variant={relation.sensitivity === "sensitive" ? "destructive" : "secondary"}>{formatSensitivity(relation.sensitivity)}</Badge><Badge variant="outline">{formatPercent(relation.confidence)}</Badge><Button size="sm" variant="ghost" onClick={() => void onForget(relation.id)} disabled={loading} data-knowledge-action="forget_relation"><Link2Off /> Quên</Button></div>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">độ tin cậy {formatTrust(relation.trust)} · cập nhật {formatDate(relation.updatedAt)}</p>
    </div>
  );
}

function PendingRow({ item, loading, onAction }: { item: PendingKnowledgeItem; loading: boolean; onAction: (action: KnowledgeGraphAction, item: PendingKnowledgeItem) => Promise<void> }): ReactElement {
  return (
    <div className="knowledge-row rounded-2xl border border-white/10 bg-card/60 p-4 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-semibold">Đang chờ #{item.id}</p>
          <p className="mt-1 text-muted-foreground">{item.payloadSummary}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => void onAction("approve_pending", item)} disabled={loading} data-knowledge-action="approve_pending"><Check /> Duyệt</Button>
          <Button size="sm" variant="outline" onClick={() => void onAction("sanitize_pending", item)} disabled={loading} data-knowledge-action="sanitize_pending"><Sparkles /> Làm sạch</Button>
          <Button size="sm" variant="outline" onClick={() => void onAction("reject_pending", item)} disabled={loading} data-knowledge-action="reject_pending"><X /> Từ chối</Button>
        </div>
      </div>
      <Separator className="my-3" />
      <p className="text-xs text-muted-foreground">{item.reason || item.sourceAttribution?.label || item.source || formatDate(item.createdAt)} / consent {item.explicitConsent ? "yes" : "no"}</p>
    </div>
  );
}

function EntitySelect({ id, label, value, onChange, entities }: { id: string; label: string; value: string; onChange: (value: string) => void; entities: KnowledgeEntity[] }): ReactElement {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Select id={id} value={value} onChange={(event) => onChange(event.target.value)} data-knowledge-select={id}>
        <option value="">Choose entity</option>
        {entities.map((entity) => <option key={entity.id} value={entity.id}>#{entity.id} {entity.canonicalName}</option>)}
      </Select>
    </div>
  );
}

function EmptyText({ children }: { children: string }): ReactElement {
  return <p className="rounded-2xl border border-dashed border-white/10 bg-background/25 p-4 text-sm text-muted-foreground">{children}</p>;
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function formatPercent(value: number): string {
  return Number.isFinite(value) ? `${Math.round(value * 100)}%` : "-";
}

function formatTrust(value: { score?: unknown; level?: unknown; label?: unknown } | undefined): string {
  if (!value) return "-";
  if (typeof value.label === "string" && value.label) return formatKnowledgeTrustLabel(value.label);
  if (typeof value.level === "string" && value.level) return formatKnowledgeTrustLabel(value.level);
  if (typeof value.score === "number") return formatPercent(value.score);
  return "cần xem xét";
}

function formatKnowledgeKind(value: string): string {
  return formatKnowledgeValue(value, { person: "người", project: "dự án", preference: "sở thích", topic: "chủ đề", fact: "thông tin", entity: "thực thể" });
}

function formatKnowledgeScope(value: string): string {
  return formatKnowledgeValue(value, { core: "cốt lõi", project: "dự án", session: "phiên", global: "toàn cục", local: "cục bộ" });
}

function formatSensitivity(value: string): string {
  return formatKnowledgeValue(value, { sensitive: "nhạy cảm", normal: "bình thường", public: "công khai", private: "riêng tư" });
}

function formatRelationType(value: string): string {
  return formatKnowledgeValue(value, { likes: "thích", dislikes: "không thích", works_on: "làm việc với", related_to: "liên quan đến", owns: "sở hữu", uses: "dùng" });
}

function formatKnowledgeTrustLabel(value: string): string {
  return formatKnowledgeValue(value, { high: "cao", medium: "trung bình", low: "thấp", review: "cần xem xét", trusted: "đáng tin", uncertain: "chưa chắc chắn" });
}

function formatKnowledgeValue(value: string, dictionary: Record<string, string>): string {
  if (!value) return "-";
  return dictionary[value] ?? value.replace(/[_-]+/g, " ");
}
