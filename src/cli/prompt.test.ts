import assert from "node:assert/strict";
import test from "node:test";

import { createCliQuestioner } from "./prompt.js";

test("createCliQuestioner reads non-TTY answers without echoing secrets", async () => {
  const output: string[] = [];
  const questioner = createCliQuestioner({ inputText: "alice\nsecret-token\n", write: (chunk) => output.push(chunk) });

  assert.equal(await questioner.ask("Name: "), "alice");
  assert.equal(await questioner.askHidden("Token: "), "secret-token");
  assert.deepEqual(output, ["Name: ", "\n", "Token: ", "\n"]);
});

test("createCliQuestioner can echo non-TTY chat answers", async () => {
  const output: string[] = [];
  const questioner = createCliQuestioner({ echoAnswer: true, inputText: "hello\n", write: (chunk) => output.push(chunk) });

  assert.equal(await questioner.ask("[YOU] > "), "hello");
  assert.deepEqual(output, ["[YOU] > hello\n"]);
});

test("createCliQuestioner can return undefined at non-TTY input end", async () => {
  const output: string[] = [];
  const questioner = createCliQuestioner({ echoAnswer: true, inputText: "hello\n", returnUndefinedOnInputEnd: true, write: (chunk) => output.push(chunk) });

  assert.equal(await questioner.ask("[YOU] > "), "hello");
  assert.equal(await questioner.ask("[YOU] > "), undefined);
  assert.deepEqual(output, ["[YOU] > hello\n"]);
});

test("createCliQuestioner parses non-TTY confirm answers", async () => {
  const output: string[] = [];
  const questioner = createCliQuestioner({ inputText: "y\n\nno\ntrue\n", write: (chunk) => output.push(chunk) });

  assert.equal(await questioner.confirm("Allow? "), true);
  assert.equal(await questioner.confirm("Default yes? ", true), true);
  assert.equal(await questioner.confirm("Deny? ", true), false);
  assert.equal(await questioner.confirm("Truth? "), true);
  assert.deepEqual(output, ["Allow? ", "\n", "Default yes? ", "\n", "Deny? ", "\n", "Truth? ", "\n"]);
});

test("createCliQuestioner selects non-TTY choices by number or value", async () => {
  const output: string[] = [];
  const questioner = createCliQuestioner({ inputText: "2\nopenai\n", write: (chunk) => output.push(chunk) });
  const choices = [
    { name: "Anthropic", value: "anthropic" },
    { name: "OpenAI", value: "openai" },
  ];

  assert.equal(await questioner.select("Provider? ", choices), "openai");
  assert.equal(await questioner.select("Provider? ", choices), "openai");
  assert.deepEqual(output, ["Provider? ", "\n", "Provider? ", "\n"]);
});