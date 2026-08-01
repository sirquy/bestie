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
import type { KnowledgeEntity, KnowledgeGraphAction, KnowledgeGraphSummary, KnowledgeRelation, PendingKnowledgeItem } from "./types";

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

export function KnowledgePanel({ data, loading, onData, onLoading }: KnowledgePanelProps): ReactElement {
  const [query, setQuery] = useState("");
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
      setActionMessage(nextData.message ?? success ?? null);
    } catch (error: unknown) {
      setActionError(formatError(error));
    } finally {
      onLoading(false);
    }
  }

  async function reload(): Promise<void> {
    setQuery("");
    await runRequest(() => fetchJson<KnowledgeGraphSummary>("/api/knowledge-graph"));
  }

  async function search(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const trimmed = query.trim();
    await runRequest(() => fetchJson<KnowledgeGraphSummary>(trimmed ? `/api/knowledge-graph/search?q=${encodeURIComponent(trimmed)}` : "/api/knowledge-graph"));
  }

  async function postAction(body: Record<string, unknown>, confirmText: string): Promise<void> {
    if (!await confirmDialog(confirmText)) return;
    await runRequest(() => fetchJson<KnowledgeGraphSummary>("/api/knowledge-graph/action", { method: "POST", body: JSON.stringify({ ...body, confirm: true }) }));
  }

  async function runPendingAction(action: KnowledgeGraphAction, item: PendingKnowledgeItem): Promise<void> {
    const label = action === "approve_pending" ? "Approve" : action === "sanitize_pending" ? "Sanitize" : "Reject";
    await postAction({ action, id: item.id }, `${label} pending knowledge item #${item.id}?`);
  }

  async function mergeEntities(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const primaryId = Number(mergePrimaryId);
    const duplicateId = Number(mergeDuplicateId);
    if (!primaryId || !duplicateId || primaryId === duplicateId) {
      setActionError("Choose two different entities to merge.");
      return;
    }
    await postAction({ action: "merge_entity", primaryId, duplicateId, reason }, `Merge entity #${duplicateId} into #${primaryId}? This may require approval.`);
  }

  async function updateRelation(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const id = Number(relationDraft.relationId);
    if (!id) {
      setActionError("Choose a relation to update.");
      return;
    }
    const body: Record<string, unknown> = { action: "update_relation", id, reason };
    if (relationDraft.confidence.trim()) body.confidence = Number(relationDraft.confidence);
    if (relationDraft.evidence.trim()) body.evidence = relationDraft.evidence.trim();
    if (relationDraft.scope) body.scope = relationDraft.scope;
    if (relationDraft.sensitivity) body.sensitivity = relationDraft.sensitivity;
    if (Object.keys(body).length <= 3) {
      setActionError("Provide confidence, evidence, scope, or sensitivity before updating.");
      return;
    }
    await postAction(body, `Update relation #${id}? This may require approval.`);
  }

  if (!data) {
    return (
      <Alert className="border-accent/40 bg-accent/10">
        <GitBranch className="size-4" />
        <AlertTitle>Knowledge Graph is loading</AlertTitle>
        <AlertDescription>Reading local entities, relations, pending items, and trust review data.</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="grid gap-4">
      {actionError ? <KnowledgeError message={actionError} /> : null}
      {actionMessage ? <Alert className="border-primary/40 bg-primary/10"><Check className="size-4" /><AlertTitle>Updated</AlertTitle><AlertDescription>{actionMessage}</AlertDescription></Alert> : null}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5" data-knowledge-summary="true">
        <KnowledgeMetric label="Entities" value={String(data.counts.entities)} />
        <KnowledgeMetric label="Relations" value={String(data.counts.relations)} />
        <KnowledgeMetric label="Pending" value={String(data.counts.pending)} tone={data.counts.pending ? "warn" : "good"} />
        <KnowledgeMetric label="Trust" value={formatTrust(data.trust)} />
        <KnowledgeMetric label="Status" value={data.state.paused ? "paused" : "active"} tone={data.state.paused ? "warn" : "good"} />
      </div>

      <Card className="border-white/10 bg-background/35">
        <CardHeader className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2"><Database className="size-5" /> Knowledge database</CardTitle>
            <CardDescription>{data.database.path}</CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant={data.database.exists ? "secondary" : "destructive"}>{data.database.exists ? "exists" : "missing"}</Badge>
            <Badge variant={data.state.paused ? "destructive" : "outline"}>{data.state.paused ? "paused" : "active"}</Badge>
            <Button variant="outline" onClick={() => void reload()} disabled={loading}><RefreshCw className={loading ? "animate-spin" : ""} /> Reload</Button>
          </div>
        </CardHeader>
        <CardContent className="grid gap-3">
          <form className="grid gap-2 md:grid-cols-[1fr_auto]" onSubmit={(event) => void search(event)}>
            <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search entities, relations, and pending knowledge" />
            <Button type="submit" disabled={loading}><Search /> Search</Button>
          </form>
          {data.query ? <p className="text-sm text-muted-foreground">Search query: <span className="text-foreground">{data.query}</span></p> : null}
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <Card className="border-white/10 bg-background/35" id="knowledge-cytoscape">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><GitBranch className="size-5" /> 3D Knowledge Map</CardTitle>
            <CardDescription>Spatial map of entities, relation edges, confidence, scope, and sensitivity.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <KnowledgeMap3D entities={data.entities} relations={data.relations} />
            <Separator />
            <section className="grid gap-3">
              <div className="flex items-center justify-between gap-2"><h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-muted-foreground">Entities</h3><Badge variant="outline">{data.entities.length}</Badge></div>
              {data.entities.length ? data.entities.map((entity) => <EntityRow key={entity.id} entity={entity} loading={loading} onForget={(id) => postAction({ action: "forget_entity", id, reason }, `Forget entity #${id}? This may require approval.`)} />) : <EmptyText>No entities found.</EmptyText>}
            </section>
            <Separator />
            <section className="grid gap-3">
              <div className="flex items-center justify-between gap-2"><h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-muted-foreground">Relations</h3><Badge variant="outline">{data.relations.length}</Badge></div>
              {data.relations.length ? data.relations.map((relation) => <RelationRow key={relation.id} relation={relation} loading={loading} onForget={(id) => postAction({ action: "forget_relation", id, reason }, `Forget relation #${id}? This may require approval.`)} />) : <EmptyText>No relations found.</EmptyText>}
            </section>
          </CardContent>
        </Card>

        <div className="grid gap-4">
          <Card className="border-white/10 bg-background/35">
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><ShieldAlert className="size-5" /> Pending review</CardTitle>
              <CardDescription>Approve, reject, or sanitize extracted knowledge before it lands in memory.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              {data.pending.length ? data.pending.map((item) => <PendingRow key={item.id} item={item} loading={loading} onAction={runPendingAction} />) : <EmptyText>No pending knowledge items.</EmptyText>}
            </CardContent>
          </Card>

          <Card className="border-white/10 bg-background/35">
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Sparkles className="size-5" /> Graph actions</CardTitle>
              <CardDescription>Actions are confirmation-gated and may enter the approval queue.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="knowledge-reason">Reason</Label>
                <Textarea id="knowledge-reason" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Optional reason for audit trail" rows={2} />
              </div>
              <form className="grid gap-3" onSubmit={(event) => void mergeEntities(event)}>
                <div className="grid gap-2 md:grid-cols-2">
                  <EntitySelect id="knowledge-primary-entity" label="Primary entity" value={mergePrimaryId} onChange={setMergePrimaryId} entities={entityOptions} />
                  <EntitySelect id="knowledge-duplicate-entity" label="Duplicate entity" value={mergeDuplicateId} onChange={setMergeDuplicateId} entities={entityOptions} />
                </div>
                <Button type="submit" variant="outline" disabled={loading || entityOptions.length < 2} data-knowledge-graph-action="merge_entity"><Merge /> Merge entities</Button>
              </form>
              <Separator />
              <form className="grid gap-3" onSubmit={(event) => void updateRelation(event)}>
                <div className="grid gap-2">
                  <Label htmlFor="knowledge-relation-select">Relation</Label>
                  <Select id="knowledge-relation-select" value={relationDraft.relationId} onChange={(event) => setRelationDraft((current) => ({ ...current, relationId: event.target.value }))} data-knowledge-select="relation">
                    <option value="">Choose relation</option>
                    {relationOptions.map((relation) => <option key={relation.id} value={relation.id}>#{relation.id} {relation.sourceName} → {relation.targetName}</option>)}
                  </Select>
                </div>
                <div className="grid gap-2 md:grid-cols-3">
                  <Input value={relationDraft.confidence} onChange={(event) => setRelationDraft((current) => ({ ...current, confidence: event.target.value }))} placeholder="confidence 0-1" inputMode="decimal" />
                  <Select value={relationDraft.scope} onChange={(event) => setRelationDraft((current) => ({ ...current, scope: event.target.value as RelationEditDraft["scope"] }))}>
                    <option value="">Scope</option><option value="core">core</option><option value="project">project</option><option value="session">session</option>
                  </Select>
                  <Select value={relationDraft.sensitivity} onChange={(event) => setRelationDraft((current) => ({ ...current, sensitivity: event.target.value as RelationEditDraft["sensitivity"] }))}>
                    <option value="">Sensitivity</option><option value="normal">normal</option><option value="sensitive">sensitive</option>
                  </Select>
                </div>
                <Textarea value={relationDraft.evidence} onChange={(event) => setRelationDraft((current) => ({ ...current, evidence: event.target.value }))} placeholder="Updated evidence" rows={2} />
                <Button type="submit" variant="outline" disabled={loading || !relationOptions.length} data-knowledge-graph-action="update_relation"><Check /> Update relation</Button>
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
      <AlertTitle>Knowledge graph request failed</AlertTitle>
      <AlertDescription>{message}</AlertDescription>
    </Alert>
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

function KnowledgeMap3D({ entities, relations }: { entities: KnowledgeEntity[]; relations: KnowledgeRelation[] }): ReactElement {
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
        .nodeLabel((node) => `${node.name}<br/>${node.kind} ? ${formatPercent(node.confidence)} ? ${node.trust}`)
        .nodeVal((node) => node.size)
        .nodeColor((node) => node.color)
        .nodeOpacity(0.92)
        .nodeResolution(24)
        .linkLabel((link) => `${link.relation.sourceName} ${link.relationType} ${link.relation.targetName}<br/>confidence ${formatPercent(link.confidence)}`)
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

  if (!entities.length) return <EmptyText>No entities to map yet.</EmptyText>;

  return (
    <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-[radial-gradient(circle_at_50%_20%,rgba(166,244,172,0.15),transparent_18rem),radial-gradient(circle_at_80%_65%,rgba(255,181,91,0.10),transparent_18rem),linear-gradient(135deg,rgba(255,255,255,0.06),rgba(255,255,255,0.01))]" data-knowledge-map-3d>
      <div className="absolute left-4 top-4 z-10 flex flex-wrap gap-2 text-xs"><Badge variant="secondary">{graphData.nodes.length} nodes</Badge><Badge variant="outline">{graphData.links.length} links</Badge><Badge variant="outline">WebGL force map</Badge></div>
      <div ref={containerRef} className="h-[34rem] w-full" data-knowledge-map-canvas />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-background/90 via-background/45 to-transparent p-4 pt-16">
        <div className="grid gap-2 text-xs text-muted-foreground md:grid-cols-3">
          <span>Drag to orbit ? scroll to zoom ? click node to focus</span><span>Particles show relation direction and confidence</span><span>Red = sensitive, green/blue = normal scoped memory</span>
        </div>
      </div>
      {selectedNode ? <div className="absolute right-4 top-4 z-10 max-w-xs rounded-2xl border border-white/10 bg-background/85 p-3 text-xs shadow-xl backdrop-blur" data-knowledge-map-selected><p className="font-semibold text-foreground">{selectedNode.name}</p><p className="mt-1 text-muted-foreground">{selectedNode.kind} ? {selectedNode.scope} ? confidence {formatPercent(selectedNode.confidence)}</p><p className="mt-1 text-muted-foreground">trust {selectedNode.trust}</p></div> : null}
      <div className="hidden" data-knowledge-map-node={graphData.nodes[0]?.id ?? "none"} />
      <div className="hidden" data-knowledge-map-edge={graphData.links[0]?.id ?? "none"} />
    </div>
  );
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
    <div className="knowledge-row rounded-2xl border border-white/10 bg-card/60 p-4 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-semibold">#{entity.id} {entity.canonicalName}</p>
          <p className="mt-1 text-muted-foreground">{entity.kind}{entity.aliases.length ? ` / aliases: ${entity.aliases.join(", ")}` : ""}</p>
        </div>
        <div className="flex flex-wrap gap-2"><Badge variant="outline">{entity.scope}</Badge><Badge variant={entity.sensitivity === "sensitive" ? "destructive" : "secondary"}>{entity.sensitivity}</Badge></div>
      </div>
      <Separator className="my-3" />
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
        <span>confidence {formatPercent(entity.confidence)} / trust {formatTrust(entity.trust)} / updated {formatDate(entity.updatedAt)}</span>
        <Button size="sm" variant="outline" onClick={() => void onForget(entity.id)} disabled={loading} data-knowledge-action="forget_entity"><Trash2 /> Forget</Button>
      </div>
    </div>
  );
}

function RelationRow({ relation, loading, onForget }: { relation: KnowledgeRelation; loading: boolean; onForget: (id: number) => Promise<void> }): ReactElement {
  return (
    <div className="knowledge-row rounded-2xl border border-white/10 bg-card/60 p-4 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-semibold">#{relation.id} {relation.sourceName} <span className="text-muted-foreground">{relation.relationType}</span> {relation.targetName}</p>
          <p className="mt-1 text-muted-foreground">{relation.evidence || "No evidence text."}</p>
        </div>
        <div className="flex flex-wrap gap-2"><Badge variant="outline">{relation.scope}</Badge><Badge variant={relation.sensitivity === "sensitive" ? "destructive" : "secondary"}>{relation.sensitivity}</Badge></div>
      </div>
      <Separator className="my-3" />
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
        <span>confidence {formatPercent(relation.confidence)} / trust {formatTrust(relation.trust)} / updated {formatDate(relation.updatedAt)}</span>
        <Button size="sm" variant="outline" onClick={() => void onForget(relation.id)} disabled={loading} data-knowledge-action="forget_relation"><Link2Off /> Forget</Button>
      </div>
    </div>
  );
}

function PendingRow({ item, loading, onAction }: { item: PendingKnowledgeItem; loading: boolean; onAction: (action: KnowledgeGraphAction, item: PendingKnowledgeItem) => Promise<void> }): ReactElement {
  return (
    <div className="knowledge-row rounded-2xl border border-white/10 bg-card/60 p-4 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-semibold">Pending #{item.id}</p>
          <p className="mt-1 text-muted-foreground">{item.payloadSummary}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => void onAction("approve_pending", item)} disabled={loading} data-knowledge-action="approve_pending"><Check /> Approve</Button>
          <Button size="sm" variant="outline" onClick={() => void onAction("sanitize_pending", item)} disabled={loading} data-knowledge-action="sanitize_pending"><Sparkles /> Sanitize</Button>
          <Button size="sm" variant="outline" onClick={() => void onAction("reject_pending", item)} disabled={loading} data-knowledge-action="reject_pending"><X /> Reject</Button>
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
  if (typeof value.label === "string" && value.label) return value.label;
  if (typeof value.level === "string" && value.level) return value.level;
  if (typeof value.score === "number") return formatPercent(value.score);
  return "review";
}
