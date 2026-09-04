import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import { ZALO_PERSONAL_OPERATION_NAMES } from "./capabilities.js";
import { loginZaloPersonalWithQr, ZaloPersonalClient, type ZaloPersonalApi, type ZaloPersonalZcaModule } from "./client.js";

function createApi(sent: Array<{ message: unknown; threadId: string; type: number }>, typing: Array<{ threadId: string; type: number; destType?: number }> = []): ZaloPersonalApi {
  return {
    listener: {
      on: () => undefined,
      off: () => undefined,
      start: () => undefined,
      stop: () => undefined,
    },
    getUserInfo: async () => ({ changed_profiles: {} }),
    sendMessage: async (message, threadId, type) => {
      sent.push({ message, threadId, type });
      return { message: { msgId: 11 }, attachment: [{ msgId: 22 }] };
    },
    sendTypingEvent: async (threadId: string, type: number, destType?: number) => { typing.push({ threadId, type, destType }); },
  };
}

test("Zalo Personal client maps direct and group messages while suppressing self events", async () => {
  const client = ZaloPersonalClient.fromApi(createApi([]));

  const text = client.toUpdate({
    threadId: "controller-1",
    type: 0,
    isSelf: false,
    data: { msgId: "text-1", uidFrom: "controller-1", content: "xin chào" },
  });
  const image = client.toUpdate({
    threadId: "controller-1",
    type: 0,
    isSelf: false,
    data: { msgId: "image-1", uidFrom: "controller-1", msgType: "image", content: { href: "https://media.example.test/photo.jpg", title: "photo.jpg", totalSize: 3, type: "image" } },
  });
  const sticker = client.toUpdate({
    threadId: "controller-1",
    type: 0,
    isSelf: false,
    data: { msgId: "sticker-1", uidFrom: "controller-1", msgType: "sticker", content: { emoji: "🙂" } },
  });
  const group = client.toUpdate({
    threadId: "group-1",
    type: 1,
    isSelf: false,
    data: { msgId: "group-1", uidFrom: "member-1", content: "@Miu help", mentions: [{ uid: "automation-1" }] },
  });

  assert.deepEqual(text?.message, { message_id: "text-1", from: { id: "controller-1" }, chat: { id: "controller-1", type: "private" }, text: "xin chào" });
  assert.deepEqual(image?.message?.photo, { file_id: "https://media.example.test/photo.jpg", file_path: "https://media.example.test/photo.jpg", file_name: "photo.jpg", file_size: 3 });
  assert.deepEqual(await client.getFile("https://media.example.test/photo.jpg"), { fileId: "https://media.example.test/photo.jpg", filePath: "https://media.example.test/photo.jpg", fileSize: 3 });
  assert.equal(sticker?.message?.text, "[User sent a sticker.]");
  assert.deepEqual(group?.message, {
    message_id: "group-1",
    from: { id: "member-1" },
    chat: { id: "group-1", type: "group" },
    text: "@Miu help",
    quote: { msgId: "group-1", uidFrom: "member-1", content: "@Miu help", mentions: [{ uid: "automation-1" }] },
    mentions: [{ uid: "automation-1" }],
  });
  assert.equal(client.toUpdate({ threadId: "controller-1", type: 0, isSelf: true, data: { uidFrom: "controller-1", content: "loop" } }), undefined);
});

test("Zalo Personal client sends text, photos, and documents through zca-js attachments", async () => {
  const sent: Array<{ message: unknown; threadId: string; type: number }> = [];
  const client = ZaloPersonalClient.fromApi(createApi(sent));

  assert.deepEqual(await client.sendMessage("controller-1", "hello"), { messageId: 11 });
  assert.deepEqual(await client.sendPhoto("controller-1", new Uint8Array([1, 2, 3]), { fileName: "answer.png", caption: "image" }), { messageId: 11 });
  assert.deepEqual(await client.sendDocument("controller-1", new Uint8Array([4, 5]), { fileName: "answer.txt", caption: "file" }), { messageId: 11 });
  const quote = { msgId: "incoming-1", uidFrom: "member-1" };
  assert.deepEqual(await client.sendMessage("group-1", "group reply", { threadType: 1, quote }), { messageId: 11 });
  assert.deepEqual(await client.sendPhoto("group-1", new Uint8Array([6]), { threadType: 1 }), { messageId: 11 });
  assert.deepEqual(sent, [
    { message: "hello", threadId: "controller-1", type: 0 },
    { message: { msg: "image", attachments: { data: Buffer.from([1, 2, 3]), filename: "answer.png", metadata: { totalSize: 3 } } }, threadId: "controller-1", type: 0 },
    { message: { msg: "file", attachments: { data: Buffer.from([4, 5]), filename: "answer.txt", metadata: { totalSize: 2 } } }, threadId: "controller-1", type: 0 },
    { message: { msg: "group reply", quote }, threadId: "group-1", type: 1 },
    { message: { msg: "", attachments: { data: Buffer.from([6]), filename: "bestie-photo.jpg", metadata: { totalSize: 1 } } }, threadId: "group-1", type: 1 },
  ]);
});

test("Zalo Personal client sends typing events with the correct zca-js thread and destination types", async () => {
  const typing: Array<{ threadId: string; type: number; destType?: number }> = [];
  const client = ZaloPersonalClient.fromApi(createApi([], typing));

  await client.sendChatAction("controller-1", "typing", 0);
  await client.sendChatAction("group-1", "typing", 1);

  assert.deepEqual(typing, [
    { threadId: "controller-1", type: 0, destType: 3 },
    { threadId: "group-1", type: 1, destType: undefined },
  ]);
});

test("Zalo Personal client forwards every supported capability only through its allowlisted facade", async () => {
  const calls: Array<{ operation: string; args: unknown[] }> = [];
  const api = createApi([]);
  for (const operation of ZALO_PERSONAL_OPERATION_NAMES) {
    (api as Record<string, unknown>)[operation] = (...args: unknown[]) => {
      calls.push({ operation, args });
      return { operation };
    };
  }
  const client = ZaloPersonalClient.fromApi(api);

  assert.equal(ZALO_PERSONAL_OPERATION_NAMES.length, 145, "zca-js@2.1.2 API contract changed; update the Zalo Personal capability registry.");
  for (const operation of ZALO_PERSONAL_OPERATION_NAMES) {
    assert.deepEqual(await client.execute(operation, [operation]), { operation });
  }
  assert.deepEqual(calls, ZALO_PERSONAL_OPERATION_NAMES.map((operation) => ({ operation, args: [operation] })));
  await assert.rejects(() => client.execute("not-a-zca-api" as never), /Unsupported Zalo Personal operation/);
});

test("Zalo Personal QR login saves a private temporary QR before reporting it", async () => {
  const rootDir = await mkdtemp(resolve(tmpdir(), "bestie-zalo-personal-qr-test-"));
  const qrPath = resolve(rootDir, "qr.png");
  const events: number[] = [];
  const api = createApi([]);

  class FakeZalo {
    async loginQR(_options: { qrPath: string }, callback: (event: any) => void): Promise<ZaloPersonalApi> {
      callback({ type: 0, data: null, actions: { saveToFile: () => writeFile(qrPath, new Uint8Array([1, 2, 3]), { mode: 0o666 }) } });
      callback({ type: 4, data: { cookie: [{ name: "session" }], imei: "imei-1", userAgent: "test-agent" }, actions: null });
      return api;
    }
  }

  try {
    const login = await loginZaloPersonalWithQr({
      qrPath,
      onEvent: (event) => events.push(event.type),
      loadModule: async () => ({ Zalo: FakeZalo } as unknown as ZaloPersonalZcaModule),
    });

    assert.deepEqual(login.credentials, { cookie: [{ name: "session" }], imei: "imei-1", userAgent: "test-agent" });
    assert.deepEqual(events, [0, 4]);
    assert.deepEqual(await readFile(qrPath), Buffer.from([1, 2, 3]));
    if (process.platform !== "win32") assert.equal((await stat(qrPath)).mode & 0o777, 0o600);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("Zalo Personal QR login retries after QR expiry", async () => {
  const rootDir = await mkdtemp(resolve(tmpdir(), "bestie-zalo-personal-qr-retry-test-"));
  const qrPath = resolve(rootDir, "qr.png");
  const events: number[] = [];
  let retries = 0;

  class FakeZalo {
    async loginQR(_options: { qrPath: string }, callback: (event: any) => void): Promise<ZaloPersonalApi> {
      callback({ type: 1, data: null, actions: { retry: () => { retries += 1; } } });
      callback({ type: 4, data: { cookie: [{ name: "session" }], imei: "imei-1", userAgent: "test-agent" }, actions: null });
      return createApi([]);
    }
  }

  try {
    await loginZaloPersonalWithQr({
      qrPath,
      onEvent: (event) => events.push(event.type),
      loadModule: async () => ({ Zalo: FakeZalo } as unknown as ZaloPersonalZcaModule),
    });

    assert.deepEqual(events, [1, 4]);
    assert.equal(retries, 1);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("Zalo Personal QR login aborts after QR decline", async () => {
  let aborts = 0;
  const events: number[] = [];

  class FakeZalo {
    async loginQR(_options: { qrPath: string }, callback: (event: any) => void): Promise<ZaloPersonalApi> {
      callback({ type: 3, data: null, actions: { abort: () => { aborts += 1; } } });
      throw new Error("upstream abort after decline");
    }
  }

  await assert.rejects(
    () => loginZaloPersonalWithQr({
      qrPath: resolve(tmpdir(), "bestie-zalo-personal-unused-qr.png"),
      onEvent: (event) => events.push(event.type),
      loadModule: async () => ({ Zalo: FakeZalo } as unknown as ZaloPersonalZcaModule),
    }),
    /Zalo QR login was declined/,
  );
  assert.deepEqual(events, [3]);
  assert.equal(aborts, 1);
});

test("Zalo Personal QR login aborts when its signal is cancelled", async () => {
  const controller = new AbortController();
  let aborts = 0;

  class FakeZalo {
    async loginQR(_options: { qrPath: string }, callback: (event: any) => void): Promise<ZaloPersonalApi> {
      callback({ type: 0, data: null, actions: { abort: () => { aborts += 1; throw new Error("login aborted"); }, saveToFile: async () => undefined } });
      return createApi([]);
    }
  }

  const login = loginZaloPersonalWithQr({
    qrPath: resolve(tmpdir(), "bestie-zalo-personal-unused-qr.png"),
    signal: controller.signal,
    loadModule: async () => ({ Zalo: FakeZalo } as unknown as ZaloPersonalZcaModule),
  });
  controller.abort();

  await assert.rejects(login, /login aborted/);
  assert.equal(aborts, 1);
});
