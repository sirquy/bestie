import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import { loginZaloPersonalWithQr, ZaloPersonalClient, type ZaloPersonalApi, type ZaloPersonalZcaModule } from "./client.js";

function createApi(sent: Array<{ message: unknown; threadId: string; type: number }>): ZaloPersonalApi {
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
    sendTypingEvent: async () => undefined,
  };
}

test("Zalo Personal client maps direct text and media, while suppressing self and group events", async () => {
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

  assert.deepEqual(text?.message, { message_id: "text-1", from: { id: "controller-1" }, chat: { id: "controller-1", type: "private" }, text: "xin chào" });
  assert.deepEqual(image?.message?.photo, { file_id: "https://media.example.test/photo.jpg", file_path: "https://media.example.test/photo.jpg", file_name: "photo.jpg", file_size: 3 });
  assert.deepEqual(await client.getFile("https://media.example.test/photo.jpg"), { fileId: "https://media.example.test/photo.jpg", filePath: "https://media.example.test/photo.jpg", fileSize: 3 });
  assert.equal(client.toUpdate({ threadId: "controller-1", type: 0, isSelf: true, data: { uidFrom: "controller-1", content: "loop" } }), undefined);
  assert.equal(client.toUpdate({ threadId: "group-1", type: 1, isSelf: false, data: { uidFrom: "controller-1", content: "group" } }), undefined);
});

test("Zalo Personal client sends text, photos, and documents through zca-js attachments", async () => {
  const sent: Array<{ message: unknown; threadId: string; type: number }> = [];
  const client = ZaloPersonalClient.fromApi(createApi(sent));

  assert.deepEqual(await client.sendMessage("controller-1", "hello"), { messageId: 11 });
  assert.deepEqual(await client.sendPhoto("controller-1", new Uint8Array([1, 2, 3]), { fileName: "answer.png", caption: "image" }), { messageId: 11 });
  assert.deepEqual(await client.sendDocument("controller-1", new Uint8Array([4, 5]), { fileName: "answer.txt", caption: "file" }), { messageId: 11 });
  assert.deepEqual(sent, [
    { message: "hello", threadId: "controller-1", type: 0 },
    { message: { msg: "image", attachments: { data: Buffer.from([1, 2, 3]), filename: "answer.png", metadata: { totalSize: 3 } } }, threadId: "controller-1", type: 0 },
    { message: { msg: "file", attachments: { data: Buffer.from([4, 5]), filename: "answer.txt", metadata: { totalSize: 2 } } }, threadId: "controller-1", type: 0 },
  ]);
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
