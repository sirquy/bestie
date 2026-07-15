import assert from "node:assert/strict";
import test from "node:test";

import { isValidTimeZone, normalizeLanguageInput, normalizeTimeZoneInput } from "./locale.js";

test("normalizeLanguageInput supports app modes, language names, and canonical language tags", () => {
  assert.equal(normalizeLanguageInput(""), "vi");
  assert.equal(normalizeLanguageInput("English"), "en");
  assert.equal(normalizeLanguageInput("Vietnamese"), "vi");
  assert.equal(normalizeLanguageInput("Tiếng Việt"), "vi");
  assert.equal(normalizeLanguageInput("mixed"), "mixed");
  assert.equal(normalizeLanguageInput("pt-br"), "pt-BR");
  assert.equal(normalizeLanguageInput("zh-hant-tw"), "zh-Hant-TW");
});

test("time zone helpers validate and default safely", () => {
  assert.equal(isValidTimeZone("Asia/Ho_Chi_Minh"), true);
  assert.equal(isValidTimeZone("Moon/Base"), false);
  assert.equal(normalizeTimeZoneInput("", "UTC"), "UTC");
  assert.equal(normalizeTimeZoneInput("Moon/Base", "UTC"), "UTC");
  assert.equal(normalizeTimeZoneInput("Asia/Ho_Chi_Minh", "UTC"), "Asia/Ho_Chi_Minh");
});