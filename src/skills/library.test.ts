import assert from "node:assert/strict";
import { createSign, generateKeyPairSync } from "node:crypto";
import test from "node:test";

import { buildSkillDiff, createBundledSkillRegistrySnapshot, fetchRemoteSkillRegistrySnapshot, findCuratedSkillTemplate, hashSkillContent, hashSkillRegistry, listCuratedSkillTemplates, listSkillRegistrySources, parseRemoteSkillRegistryPayload, validateCuratedSkillRegistry, verifyDetachedSignature } from "./library.js";

test("validateCuratedSkillRegistry accepts the bundled official registry", () => {
  const result = validateCuratedSkillRegistry();
  assert.equal(result.ok, true);
  assert.equal(result.issues.length, 0);
  assert.ok(result.count >= 10);
});

test("findCuratedSkillTemplate normalizes lookup names", () => {
  const skill = findCuratedSkillTemplate(" Daily Planner ");
  assert.equal(skill?.name, "daily-planner");
  assert.equal(skill?.trust, "official");
});

test("createBundledSkillRegistrySnapshot exposes verified bundled source metadata", () => {
  const snapshot = createBundledSkillRegistrySnapshot();
  assert.equal(snapshot.source.id, "bundled-official");
  assert.equal(snapshot.source.kind, "bundled");
  assert.equal(snapshot.source.verification.status, "verified");
  assert.equal(snapshot.source.verification.method, "bundled-sha256");
  assert.match(snapshot.registryHash, /^[a-f0-9]{64}$/);
  assert.equal(snapshot.source.verification.registryHash, snapshot.registryHash);
});

test("listSkillRegistrySources reserves disabled remote registry source", () => {
  const sources = listSkillRegistrySources();
  assert.ok(sources.some((source) => source.id === "bundled-official" && source.enabled === true));
  assert.ok(sources.some((source) => source.id === "remote-official" && source.enabled === false && source.verification.status === "unavailable"));
});

test("listSkillRegistrySources reports configured remote signature readiness", () => {
  const ready = listSkillRegistrySources({ remoteOfficial: { enabled: true, url: "https://skills.example.test/registry.json", publicKey: "test-public-key" } });
  assert.ok(ready.some((source) => source.id === "remote-official" && source.enabled === true && source.verification.status === "unsigned"));

  const missingKey = listSkillRegistrySources({ remoteOfficial: { enabled: true, url: "https://skills.example.test/registry.json" } });
  assert.ok(missingKey.some((source) => source.id === "remote-official" && source.enabled === true && source.verification.status === "failed"));
});

test("validateCuratedSkillRegistry reports duplicate and malformed entries", () => {
  const base = listCuratedSkillTemplates()[0];
  assert.ok(base);
  const result = validateCuratedSkillRegistry([
    base,
    { ...base, title: "", version: "1", content: "No title", permissions: [] },
  ]);

  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.field === "name" && issue.message.includes("unique")));
  assert.ok(result.issues.some((issue) => issue.field === "title"));
  assert.ok(result.issues.some((issue) => issue.field === "version"));
  assert.ok(result.issues.some((issue) => issue.field === "content"));
});

test("hashSkillContent and buildSkillDiff are stable registry primitives", () => {
  assert.equal(hashSkillContent("# Skill\n"), hashSkillContent("# Skill"));
  const diff = buildSkillDiff("# Skill\nold", "# Skill\nnew");
  assert.deepEqual(diff.map((line) => line.kind), ["same", "removed", "added"]);
});

test("parseRemoteSkillRegistryPayload verifies detached signatures", () => {
  const keys = createTestKeys();
  const payload = JSON.stringify(createRemoteRegistryDocument());
  const signature = signPayload(payload, keys.privateKey);

  assert.equal(verifyDetachedSignature(payload, signature, keys.publicKey), true);
  assert.equal(verifyDetachedSignature(`${payload}\n`, signature, keys.publicKey), false);

  const snapshot = parseRemoteSkillRegistryPayload(payload, { config: { enabled: true, url: "https://skills.example.test/registry.json", publicKey: keys.publicKey }, signature });
  assert.equal(snapshot.source.id, "remote-official-test");
  assert.equal(snapshot.source.verification.status, "verified");
  assert.equal(snapshot.validation.ok, true);
  assert.equal(snapshot.skills[0]?.name, "remote-test-skill");
});

test("parseRemoteSkillRegistryPayload reports unsigned and invalid remote registries", () => {
  const keys = createTestKeys();
  const payload = JSON.stringify(createRemoteRegistryDocument());

  const unsigned = parseRemoteSkillRegistryPayload(payload, { config: { enabled: true, url: "https://skills.example.test/registry.json", publicKey: keys.publicKey } });
  assert.equal(unsigned.source.verification.status, "unsigned");

  assert.throws(
    () => parseRemoteSkillRegistryPayload(JSON.stringify({ schemaVersion: 1, source: { id: "bad name", name: "Bad", trust: "official" }, skills: [] }), { config: { enabled: true, url: "https://skills.example.test/registry.json", publicKey: keys.publicKey } }),
    /source\.id must be normalized/,
  );
  assert.throws(
    () => parseRemoteSkillRegistryPayload(JSON.stringify({ schemaVersion: 1, source: { id: ".uninstalled", name: "Bad", trust: "official" }, skills: [] }), { config: { enabled: true, url: "https://skills.example.test/registry.json", publicKey: keys.publicKey } }),
    /source\.id must be normalized/,
  );

  const reservedSource = parseRemoteSkillRegistryPayload(JSON.stringify({ ...createRemoteRegistryDocument(), source: { id: "bundled-official", name: "Reserved", trust: "official" } }), { config: { enabled: true, url: "https://skills.example.test/registry.json", publicKey: keys.publicKey } });
  assert.equal(reservedSource.validation.ok, false);
  assert.equal(reservedSource.source.verification.status, "failed");
  assert.match(reservedSource.validation.issues.map((issue) => issue.message).join(" "), /bundled-official/);

  const bundledCollision = createRemoteRegistryDocument();
  bundledCollision.skills[0].name = "daily-planner";
  const collision = parseRemoteSkillRegistryPayload(JSON.stringify(bundledCollision), { config: { enabled: true, url: "https://skills.example.test/registry.json", publicKey: keys.publicKey } });
  assert.equal(collision.validation.ok, false);
  assert.equal(collision.source.verification.status, "failed");
  assert.match(collision.validation.issues.map((issue) => issue.message).join(" "), /collide with a bundled skill/);
});

test("fetchRemoteSkillRegistrySnapshot uses injected fetch and signature header", async () => {
  const keys = createTestKeys();
  const payload = JSON.stringify(createRemoteRegistryDocument());
  const signature = signPayload(payload, keys.privateKey);
  const snapshot = await fetchRemoteSkillRegistrySnapshot({
    config: { enabled: true, url: "https://skills.example.test/registry.json", publicKey: keys.publicKey, signatureHeader: "x-bestie-signature", timeoutMs: 5000 },
    fetchImpl: async (url, init) => {
      assert.equal(url, "https://skills.example.test/registry.json");
      assert.equal(init?.headers && (init.headers as Record<string, string>).accept, "application/json");
      return new Response(payload, { status: 200, headers: { "x-bestie-signature": signature } });
    },
  });

  assert.equal(snapshot.source.verification.status, "verified");
  assert.equal(snapshot.source.skillCount, 1);
});

function createRemoteRegistryDocument() {
  return {
    schemaVersion: 1,
    source: { id: "remote-official-test", name: "Remote Official Test", trust: "official" },
    skills: [
      {
        name: "remote-test-skill",
        title: "Remote Test Skill",
        description: "A signed remote registry test skill.",
        category: "testing",
        version: "1.0.0",
        author: "Bestie",
        trust: "official",
        risk: "low",
        permissions: [],
        changelog: "Initial signed remote test skill.",
        content: "# Remote Test Skill\n\nUse only in tests.\n",
      },
    ],
  };
}

function createTestKeys(): { publicKey: string; privateKey: string } {
  const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return {
    publicKey: pair.publicKey.export({ type: "spki", format: "pem" }).toString(),
    privateKey: pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  };
}

function signPayload(payload: string, privateKey: string): string {
  const signer = createSign("sha256");
  signer.update(payload, "utf8");
  signer.end();
  return signer.sign(privateKey, "base64");
}
