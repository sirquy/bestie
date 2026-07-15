import assert from "node:assert/strict";
import test from "node:test";

import { generateCharacterConfig, generateSystemPrompt } from "./prompt-generator.js";

const character = generateCharacterConfig({
  name: "Miu",
  ownerName: "Sep",
  language: "vi",
  timeZone: "Asia/Ho_Chi_Minh",
  toneIntensity: 7,
});

test("generateSystemPrompt preserves Phase Now character and safety contract", () => {
  const prompt = generateSystemPrompt(character);

  assert.match(prompt, /Vietnamese-first by default/);
  assert.match(prompt, /Asia\/Ho_Chi_Minh/);
  assert.match(prompt, /funny, sharp, blunt/);
  assert.match(prompt, /teasing, never humiliating/);
  assert.match(prompt, /Challenge bad ideas/);
  assert.match(prompt, /drop the jokes and become warm, steady, and serious/);
  assert.match(prompt, /self-harm or immediate danger/);
  assert.match(prompt, /trusted people and local emergency\/crisis help/);
  assert.match(prompt, /Never be cruel, degrading, hateful, sexually explicit, or abusive/);
  assert.match(prompt, /Do not claim to be human, conscious, a therapist, a romantic partner, or to have perfect memory/);
  assert.match(prompt, /Do not pretend to remember facts that were not provided/);
});

test("generateSystemPrompt covers documented hard-fail character eval themes", () => {
  const prompt = generateSystemPrompt(character);

  assert.match(prompt, /Challenge bad ideas instead of blindly validating them/);
  assert.match(prompt, /drop the jokes and become warm, steady, and serious/);
  assert.match(prompt, /For self-harm or immediate danger/);
  assert.match(prompt, /Never be cruel, degrading, hateful, sexually explicit, or abusive/);
  assert.match(prompt, /Do not claim to be human, conscious, a therapist, a romantic partner, or to have perfect memory/);
  assert.match(prompt, /Do not pretend to remember facts that were not provided in this conversation/);
});

test("generateSystemPrompt covers manual eval response-style anchors", () => {
  const prompt = generateSystemPrompt(character);

  assert.match(prompt, /Start from the user's emotion, then give the next useful move/);
  assert.match(prompt, /If the user is procrastinating or making excuses, be lovingly brutal and suggest one tiny action/);
  assert.match(prompt, /If the user asks technical questions, give a clear checklist/);
  assert.match(prompt, /Keep replies concise unless the user asks for depth/);
});

test("generateCharacterConfig calibrates warmth above roast for vulnerable moments", () => {
  assert.equal(character.language, "vi-first");
  assert.equal(character.tone.roastLevel, 7);
  assert.ok(character.tone.warmthLevel >= 6);
  assert.ok(character.boundaries.dropJokesWhen.includes("self-harm"));
  assert.ok(character.boundaries.dropJokesWhen.includes("vulnerable"));
  assert.ok(character.boundaries.neverJokeAbout.includes("secrets"));
});

test("generateSystemPrompt supports arbitrary configured language codes", () => {
  const prompt = generateSystemPrompt(generateCharacterConfig({ name: "Miu", ownerName: "Sep", language: "ja", toneIntensity: 7 }));

  assert.match(prompt, /Use language ja by default/);
});
