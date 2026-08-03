import assert from "node:assert/strict";
import { createSign, generateKeyPairSync } from "node:crypto";
import test from "node:test";

import { buildSkillDiff, fetchRemoteSkillRegistrySnapshot, getDefaultRemoteSkillRegistryConfig, hashContent, hashSkillContent, hashSkillRegistry, listSkillRegistrySources, parseRemoteSkillRegistryPayload, validateCuratedSkillRegistry, verifyDetachedSignature } from "./library.js";

test("default remote registry points to sirquy bestie-skills", () => {
  const config = getDefaultRemoteSkillRegistryConfig();
  assert.equal(config.enabled, true);
  assert.equal(config.url, "https://raw.githubusercontent.com/sirquy/bestie-skills/master/registry.json");
  assert.equal(config.checksumUrl, "https://raw.githubusercontent.com/sirquy/bestie-skills/master/registry.sha256");
  assert.equal(config.installPolicy, "ask");
});

test("listSkillRegistrySources reports remote checksum readiness", () => {
  const sources = listSkillRegistrySources();
  assert.equal(sources.length, 1);
  assert.equal(sources[0]?.id, "remote-official");
  assert.equal(sources[0]?.kind, "remote");
  assert.equal(sources[0]?.enabled, true);
  assert.equal(sources[0]?.verification.status, "unsigned");
  assert.equal(sources[0]?.verification.method, "sha256-sidecar");
});

test("validateCuratedSkillRegistry reports duplicate and malformed entries", () => {
  const base = createRemoteRegistryDocument().skills[0] as import("./library.js").CuratedSkillTemplate;
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

test("validateCuratedSkillRegistry accepts markdown front matter before title", () => {
  const skill = createRemoteRegistryDocument().skills[0] as import("./library.js").CuratedSkillTemplate;
  const result = validateCuratedSkillRegistry([
    {
      ...skill,
      content: "---\nname: remote-test-skill\ndescription: Test skill.\n---\n\n# Remote Test Skill\n\nUse only in tests.\n",
    },
  ]);

  assert.equal(result.ok, true);
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

test("parseRemoteSkillRegistryPayload verifies checksum sidecars", () => {
  const payload = JSON.stringify(createRemoteRegistryDocument());
  const checksum = `${hashContent(payload)}  registry.json\n`;
  const snapshot = parseRemoteSkillRegistryPayload(payload, { config: { enabled: true, url: "https://skills.example.test/registry.json", checksumUrl: "https://skills.example.test/registry.sha256" }, checksum });
  assert.equal(snapshot.source.verification.status, "verified");
  assert.equal(snapshot.source.verification.method, "sha256-sidecar");

  const failed = parseRemoteSkillRegistryPayload(payload, { config: { enabled: true, url: "https://skills.example.test/registry.json", checksumUrl: "https://skills.example.test/registry.sha256" }, checksum: `bad  registry.json\n` });
  assert.equal(failed.source.verification.status, "failed");
});

test("parseRemoteSkillRegistryPayload reports invalid remote registries", () => {
  const payload = JSON.stringify(createRemoteRegistryDocument());
  const unsigned = parseRemoteSkillRegistryPayload(payload, { config: { enabled: true, url: "https://skills.example.test/registry.json", checksumUrl: "https://skills.example.test/registry.sha256" } });
  assert.equal(unsigned.source.verification.status, "unsigned");

  assert.throws(
    () => parseRemoteSkillRegistryPayload(JSON.stringify({ schemaVersion: 1, source: { id: "bad name", name: "Bad", trust: "official" }, skills: [] }), { config: { enabled: true, url: "https://skills.example.test/registry.json", checksumUrl: "https://skills.example.test/registry.sha256" } }),
    /source\.id must be normalized/,
  );

  const reservedSource = parseRemoteSkillRegistryPayload(JSON.stringify({ ...createRemoteRegistryDocument(), source: { id: "remote-official", name: "Reserved", trust: "official" } }), { config: { enabled: true, url: "https://skills.example.test/registry.json", checksumUrl: "https://skills.example.test/registry.sha256" }, checksum: `${hashContent(JSON.stringify({ ...createRemoteRegistryDocument(), source: { id: "remote-official", name: "Reserved", trust: "official" } }))} registry.json` });
  assert.equal(reservedSource.validation.ok, false);
  assert.equal(reservedSource.source.verification.status, "failed");
  assert.match(reservedSource.validation.issues.map((issue) => issue.message).join(" "), /reserved internal source id/);
});

test("fetchRemoteSkillRegistrySnapshot uses injected fetch and checksum URL", async () => {
  const payload = JSON.stringify(createRemoteRegistryDocument());
  const checksum = `${hashContent(payload)}  registry.json\n`;
  const snapshot = await fetchRemoteSkillRegistrySnapshot({
    config: { enabled: true, url: "https://skills.example.test/registry.json", checksumUrl: "https://skills.example.test/registry.sha256", timeoutMs: 5000 },
    fetchImpl: async (url, init) => {
      assert.equal(init?.headers && (init.headers as Record<string, string>).accept, url.toString().endsWith(".sha256") ? "text/plain" : "application/json");
      return url.toString().endsWith(".sha256") ? new Response(checksum) : new Response(payload, { status: 200 });
    },
  });

  assert.equal(snapshot.source.verification.status, "verified");
  assert.equal(snapshot.source.skillCount, 1);
  assert.match(hashSkillRegistry(snapshot.skills), /^[a-f0-9]{64}$/);
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
