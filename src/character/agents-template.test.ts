import assert from "node:assert/strict";
import test from "node:test";

import { getDefaultAgentsMarkdown } from "./agents-template.js";

test("default AGENTS.md explains memory knowledge and tool decision boundaries", () => {
  const markdown = getDefaultAgentsMarkdown();

  assert.match(markdown, /Structured knowledge is stored in the local knowledge graph/);
  assert.match(markdown, /Memory is the primary continuity layer/);
  assert.match(markdown, /Knowledge graph is the structured layer for entities and relationships/);
  assert.match(markdown, /Use knowledge graph tools when/);
  assert.match(markdown, /When memory and knowledge graph disagree/);
  assert.match(markdown, /Runtime tool loops may ask for a tool decision/);
  assert.match(markdown, /reply with exactly one JSON object and no extra prose/);
  assert.match(markdown, /Do not promise to call a tool later/);
  assert.match(markdown, /After the runtime converts `\{"answer":"\.\.\."\}` into a user-facing reply/);
  assert.match(markdown, /One useful message beats five noisy interruptions/);
  assert.doesNotMatch(markdown, /notification gremlins/);
});
