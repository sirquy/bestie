

--- zep-docs://quick-start-guide ---
> For clean Markdown of any page, append .md to the page URL.
> For a complete documentation index, see https://help.getzep.com/llms.txt.
> For AI client integration (Claude Code, Cursor, etc.), connect to the MCP server at https://help.getzep.com/_mcp/server.

# Quick Start Guide

> Add agent memory to your app in three lines of code. This Zep quick start covers users, threads, ingesting data, and retrieving a Context Block in under 200ms.

Zep delivers agent memory at enterprise scale, giving your AI agents the right context at the right time. From a temporal Context Graph, Zep assembles relevant context from chat history, business data, and user behavior—so agents make better decisions with accurate, up-to-date information. With a simple three-line API and sub-200ms retrieval, Zep helps you build personalized, reliable agents without building a context pipeline.

Get started with the example in the video using:

```bash
git clone https://github.com/getzep/zep.git
cd zep/examples/python/agent-memory-full-example
```

This guide shows you how to integrate Zep into your AI application to provide personalized context for every user interaction. You'll learn how to ingest user messages and business data, then retrieve assembled context that includes user preferences, traits, and relevant facts—all optimized for your LLM's context window.

Looking for a more in-depth understanding? Check out our [Key Concepts](/concepts) page.

Migrating from Mem0? Check out our [Mem0 Migration](/mem0-to-zep) guide.

## Install the Zep SDK

Set up your Python project, ideally with [a virtual environment](https://medium.com/@vkmauryavk/managing-python-virtual-environments-with-uv-a-comprehensive-guide-ac74d3ad8dff), and then:

```bash pip
pip install zep-cloud
```

```bash uv
uv pip install zep-cloud
```

Set up your TypeScript project and then:

```bash npm
npm install @getzep/zep-cloud
```

```bash yarn
yarn add @getzep/zep-cloud
```

```bash pnpm
pnpm install @getzep/zep-cloud
```

Set up your Go project and then:

```bash
go get github.com/getzep/zep-go/v3
```

## Initialize the Zep client

After [creating a Zep account](https://app.getzep.com/), obtaining an API key, and setting the API key as an environment variable, initialize the client once at application startup and reuse it throughout your application.

```python Python
import os
from zep_cloud.client import Zep

API_KEY = os.environ.get('ZEP_API_KEY')

client = Zep(
    api_key=API_KEY,
)
```

```typescript TypeScript
import { ZepClient } from "@getzep/zep-cloud";

const API_KEY = process.env.ZEP_API_KEY;

const client = new ZepClient({
  apiKey: API_KEY,
});
```

```go Go
import (
    zepclient "github.com/getzep/zep-go/v3/client"
    "github.com/getzep/zep-go/v3/option"
)

client := zepclient.NewClient(
    option.WithAPIKey(os.Getenv("ZEP_API_KEY")),
)
```

```
ZEP_API_KEY=your_api_key_here
```

## Create a Zep user for each of your users

Whenever users are created in your application, you need to trigger the creation of a Zep user. Make sure to include at least their first name, and ideally also their last name and email to ensure correct identification of the user in future messages. We recommend setting the Zep user ID equal to your internal user ID.

**Backfilling existing users:** For existing users, you will need to run a one-time migration to create a user for each of the existing users (simply loop through and call `user.add` for each).

Provide at least the first name and ideally the last name when calling `user.add` to ensure Zep correctly associates the user with references in your data. If needed, add this information later using the [update user](/sdk-reference/user/update) method.

```python Python
from zep_cloud.client import Zep

client = Zep(api_key=API_KEY)

# You can choose any user ID, but we recommend using your internal user ID
user_id = "your_internal_user_id"

new_user = client.user.add(
    user_id=user_id,
    email="jane.smith@example.com",
    first_name="Jane",
    last_name="Smith",
)
```

```typescript TypeScript
import { ZepClient } from "@getzep/zep-cloud";

const client = new ZepClient({
  apiKey: API_KEY,
});

// You can choose any user ID, but we recommend using your internal user ID
const userId = "your_internal_user_id";

const user = await client.user.add({
  userId: userId,
  email: "jane.smith@example.com",
  firstName: "Jane",
  lastName: "Smith",
});
```

```go Go
import (
	"context"
	"log"

	"github.com/getzep/zep-go/v3"
	zepclient "github.com/getzep/zep-go/v3/client"
	"github.com/getzep/zep-go/v3/option"
)

client := zepclient.NewClient(option.WithAPIKey(apiKey))

// You can choose any user ID, but we recommend using your internal user ID
userID := "your_internal_user_id"

newUser, err := client.User.Add(context.TODO(), &zep.CreateUserRequest{
	UserID:    userID,
	Email:     zep.String("jane.smith@example.com"),
	FirstName: zep.String("Jane"),
	LastName:  zep.String("Smith"),
})
if err != nil {
	log.Fatalf("Failed to add user: %v", err)
}
```

## Create a Zep thread for each of your threads

Whenever a user starts a new conversation with your agent, you need to trigger the creation of a Zep thread. Learn more about [adding messages](/adding-messages).

**Backfilling prior conversations:** For prior conversations, you will need to run a one-time migration to create Zep threads for those conversations and add the prior messages to the respective Zep threads. For larger backfills, use the [Batch API](/adding-batch-data) to ingest historical messages efficiently.

```python Python
client = Zep(
    api_key=API_KEY,
)
thread_id = uuid.uuid4().hex # A new thread identifier

client.thread.create(
    thread_id=thread_id,
    user_id=user_id,
)
```

```typescript TypeScript
const client = new ZepClient({
  apiKey: API_KEY,
});

const threadId: string = uuid.v4(); // Generate a new thread identifier

await client.thread.create({
  threadId: threadId,
  userId: userId,
});
```

```go Go
import (
	"context"
	"log"

	"github.com/getzep/zep-go/v3"
	zepclient "github.com/getzep/zep-go/v3/client"
	"github.com/getzep/zep-go/v3/option"
	"github.com/google/uuid"
)

client := zepclient.NewClient(option.WithAPIKey(apiKey))

threadID := uuid.New().String() // Generate a new thread identifier

_, err := client.Thread.Create(context.TODO(), &zep.CreateThreadRequest{
	ThreadID: threadID,
	UserID:   userID,
})
if err != nil {
	log.Fatalf("Failed to create thread: %v", err)
}
```

## Add incoming user messages to Zep

When a new user message comes in, add the user message to Zep, providing the user's name in the message if possible.

It is important to provide the name of the user in the name field if possible, to help with graph construction.

Include the `created_at` timestamp (RFC3339 format) representing when the message was originally sent. This ensures accurate temporal understanding in the knowledge graph. See [Setting message timestamps](/adding-messages#setting-message-timestamps) for more details.

```python Python
from zep_cloud.client import Zep
from zep_cloud.types import Message
from datetime import datetime, timezone

zep_client = Zep(
    api_key=API_KEY,
)

messages = [
    Message(
        created_at=datetime.now(timezone.utc).isoformat(),
        name="Jane Smith",
        role="user",
        content="Who was Octavia Butler?",
    )
]

response = zep_client.thread.add_messages(thread_id, messages=messages)
```

```typescript TypeScript
import { ZepClient } from "@getzep/zep-cloud";
import type { Message } from "@getzep/zep-cloud/api";

const zepClient = new ZepClient({
  apiKey: API_KEY,
});

const messages: Message[] = [
    {
        createdAt: new Date().toISOString(),
        name: "Jane Smith",
        role: "user",
        content: "Who was Octavia Butler?"
    },
];

const response = await zepClient.thread.addMessages(threadId, { messages });
```

```go Go
import (
    "time"
    v3 "github.com/getzep/zep-go/v3"
    zepclient "github.com/getzep/zep-go/v3/cli

--- zep-docs://users-and-user-graphs ---
> For clean Markdown of any page, append .md to the page URL.
> For a complete documentation index, see https://help.getzep.com/llms.txt.
> For AI client integration (Claude Code, Cursor, etc.), connect to the MCP server at https://help.getzep.com/_mcp/server.

# Users and User Graphs

## Overview

A User represents an individual interacting with your application. Each User can have multiple Threads associated with them, allowing you to track and manage their interactions over time. Additionally, each user has an associated User Graph which stores the context for that user.

## Users

The unique identifier for each user is their `UserID`. This can be any string value, such as a username, email address, or UUID.

**Users Enable Simple User Privacy Management**

Deleting a User will delete all Threads and thread artifacts associated with that User with a single API call, making it easy to handle Right To Be Forgotten requests.

### Ensuring Your User Data Is Correctly Mapped to the Knowledge Graph

Adding your user's `email`, `first_name`, and `last_name` ensures that chat messages and business data are correctly mapped to the user node in the Zep knowledge graph.

For example, if business data contains your user's email address, it will be related directly to the user node.

You can associate rich business context with a User:

* `user_id`: A unique identifier of the user that maps to your internal User ID.
* `email`: The user's email.
* `first_name`: The user's first name.
* `last_name`: The user's last name.

## User Graphs

Each user has an associated User Graph that stores their context across all threads. This graph-based context system provides several important capabilities:

### Cross-Thread Context Integration

The knowledge graph does not separate the data from different threads, but integrates the data together to create a unified picture of the user. So the `thread.get_user_context` method doesn't return context derived only from that thread, but instead returns whatever user-level context is most relevant to that thread, based on the thread's most recent messages.

This means that insights and information learned in one conversation thread are automatically available in all other threads for the same user, creating a coherent and continuous context experience.

### Privacy and RTBF Capabilities

When you delete a user, all associated data is removed:

* All threads belonging to that user
* All thread artifacts (messages, metadata)
* The entire user graph and all knowledge extracted from conversations

This single-operation approach makes it simple to handle Right To Be Forgotten (RTBF) requests and comply with privacy regulations.

### Default Ontology for User Graphs

User graphs utilize Zep's default ontology, consisting of default entity types and default edge types that affect how the graph is built. You can read more about default and custom graph ontology in the [Customizing Graph Structure](/customizing-graph-structure) guide.

Each user graph comes with default entity and edge types that help classify and structure information extracted from conversations. You can also disable the default entity and edge types for specific users if you need precise control over your graph structure.

### The User Node

**User summary and the user node**

Each user has a single unique user node in their graph representing the user themselves. The [user summary](/user-summary) generated from user summary instructions lives on this user node. You can retrieve the user node and its summary using the `get_node` method described in the SDK reference.

The user node serves as a central hub in the knowledge graph, connecting all information about that user. It stores a high-level [user summary](/user-summary) — a persistent, baseline picture of who the user is, included by default in every Context Block. Its content can be steered through [User Summary Instructions](/user-summary-instructions).

## Next Steps

Now that you understand how Users and User Graphs work together, you can:

* Learn about [Threads](/threads) and how they relate to users
* Discover how to [add messages to threads](/adding-messages)
* Learn how to [retrieve context for your agent](/retrieving-context)
* Read about the [User Summary](/user-summary) included by default in every Context Block
* Explore [customizing user summaries](/user-summary-instructions)
* Understand more about [Graph Concepts](/graph-overview)

--- zep-docs://threads ---
> For clean Markdown of any page, append .md to the page URL.
> For a complete documentation index, see https://help.getzep.com/llms.txt.
> For AI client integration (Claude Code, Cursor, etc.), connect to the MCP server at https://help.getzep.com/_mcp/server.

# Threads

## Overview

Threads represent a conversation. Each User can have multiple threads, and each thread is a sequence of chat messages.

Chat messages are added to threads using [`thread.add_messages`](/adding-messages), which both adds those messages to the thread history and ingests those messages into the user-level knowledge graph. The user knowledge graph contains data from all of that user's threads to create an integrated understanding of the user.

## Relationship Between Users and Threads

`threadIds` are arbitrary identifiers that you can map to relevant business objects in your app, such as users or a conversation a user might have with your app. Before you create a thread, make sure you have created a user first.

## Automatic Cache Warming

When you create a new thread, Zep automatically warms the cache for that user's graph data in the background. This optimization improves query latency for graph operations on newly created threads by pre-loading the user's data into the hot cache tier.

The warming operation runs asynchronously and does not block the thread creation response. No additional action is required on your part—this happens automatically whenever you create a thread for a user with an existing graph.

For more information about Zep's multi-tier caching architecture and manual cache warming, see [Warming the User Cache](/performance#warming-the-user-cache).

## Next Steps

Now that you understand how Threads work, you can:

* Learn about [Users and User Graphs](/users-and-user-graphs)
* Discover how to [add messages to threads](/adding-messages)
* Learn how to [retrieve context for your agent](/retrieving-context)
* Read per-thread [Thread summaries](/thread-summaries)
* Understand more about [Graph Concepts](/graph-overview)
ERR zep-docs://adding-data-to-the-graph: MCP error -32602: MCP error -32602: Resource zep-docs://adding-data-to-the-graph not found


--- zep-docs://retrieving-context ---
> For clean Markdown of any page, append .md to the page URL.
> For a complete documentation index, see https://help.getzep.com/llms.txt.
> For AI client integration (Claude Code, Cursor, etc.), connect to the MCP server at https://help.getzep.com/_mcp/server.

# Retrieving Context

> Retrieve a token-efficient, prompt-ready Context Block from a user's Context Graph. Smart Context Assembly selects the most relevant facts and Observations in under 200ms.

Zep provides three methods for retrieving context from a User Graph, each offering different levels of control and customization.

## Choosing a retrieval method

| Method                                                                          | Query Control               | Format Control | Graph Types                      | Best For                                                   |
| ------------------------------------------------------------------------------- | --------------------------- | -------------- | -------------------------------- | ---------------------------------------------------------- |
| [**Zep's Context Block**](#zeps-context-block)                                  | Automatic (last 2 messages) | Fixed          | User graphs only                 | Most use cases - automatic relevance with optimized format |
| [**Custom Context Templates**](#custom-context-templates)                       | Automatic (last 2 messages) | Custom         | User graphs only                 | Consistent custom formatting across threads/users          |
| [**Advanced Context Block Construction**](#advanced-context-block-construction) | Full control                | Full control   | User graphs or standalone graphs | Maximum flexibility - custom queries and formats           |

***

## Zep's Context Block

Zep's Context Block is an optimized, automatically assembled string that you can directly provide as context to your agent. It is built using Smart Context Assembly (i.e. [auto search](/searching-the-graph#auto-search)). The Context Block combines semantic search, full text search, and breadth first search to return context that is highly relevant to the user's current conversation slice, utilizing the past two messages.

The Context Block is returned by the `thread.get_user_context()` method. This method uses the latest messages of the *given thread* to search the (entire) User Graph and then returns the search results in the form of the Context Block.

Note that although `thread.get_user_context()` only requires a thread ID, it is able to return context derived from any thread of that user. The thread is just used to determine what's relevant.

The Context Block provides low latency (P95 \< 200ms) while preserving detailed information from the user's graph.

### Retrieving the Context Block

```python Python
# Get context for the thread
user_context = client.thread.get_user_context(thread_id=thread_id)

# Access the context block (for use in prompts)
context_block = user_context.context
print(context_block)
```

```typescript TypeScript
// Get context for the thread
const userContext = await client.thread.getUserContext(threadId);

// Access the context block (for use in prompts)
const contextBlock = userContext.context;
console.log(contextBlock);
```

```go Go
import (
    "context"
    v3 "github.com/getzep/zep-go/v3"
)

// Get context for the thread
userContext, err := client.Thread.GetUserContext(context.TODO(), threadId, nil)
if err != nil {
    log.Fatal("Error getting context:", err)
}
// Access the context block (for use in prompts)
contextBlock := userContext.Context
fmt.Println(contextBlock)
```

### Context Block Format

The Context Block returns a user summary along with relevant facts in a structured format:

```text
# This is the user summary
<USER_SUMMARY>
Emily Painter is a user with account ID Emily0e62 who uses digital art tools for creative work. She maintains an active account with the service, though has recently experienced technical issues with the Magic Pen Tool. Emily values reliable payment processing and seeks prompt resolution for account-related issues. She expects clear communication and efficient support when troubleshooting technical problems.
</USER_SUMMARY>

# These are the most relevant facts and their valid date ranges
# format: FACT (Date range: from - to)
<FACTS>
  - Emily is experiencing issues with logging in. (2024-11-14 02:13:19+00:00 - present)
  - User account Emily0e62 has a suspended status due to payment failure. (2024-11-14 02:03:58+00:00 - present)
  - user has the id of Emily0e62 (2024-11-14 02:03:54 - present)
  - The failed transaction used a card with last four digits 1234. (2024-09-15 00:00:00+00:00 - present)
  - The reason for the transaction failure was 'Card expired'. (2024-09-15 00:00:00+00:00 - present)
  - user has the name of Emily Painter (2024-11-14 02:03:54 - present)
  - Account Emily0e62 made a failed transaction of 99.99. (2024-07-30 00:00:00+00:00 - 2024-08-30 00:00:00+00:00)
</FACTS>
```

The default Context Block can include the user summary, facts, entities, episodes, observations, and thread summaries. Smart Context Assembly selects which [context types](/context-types) appear based on relevance to the current conversation. To pin specific types or counts, use a [context template](/context-templates) or [advanced context block construction](/advanced-context-block-construction).

### Getting the Context Block Sooner

You can get the Context Block sooner by passing in the `return_context=True` flag to the `thread.add_messages()` method. Read more about this in our [performance guide](/performance#get-the-context-block-sooner).

## Custom Context Templates

You can customize the format of the Context Block by using [context templates](/context-templates). Templates allow you to define how context data is structured and presented while keeping Zep's automatic relevance detection.

To use a template, pass the `template_id` parameter when retrieving context:

```python Python
from zep_cloud import Zep

client = Zep(api_key="YOUR_API_KEY")

# Create a custom template
client.context.create_context_template(
    template_id="customer-support",
    template="""# CUSTOMER PROFILE
%{user_summary}

# FACTS
%{edges limit=10}

# KEY ENTITIES
%{entities limit=5}"""
)

# Use the template to retrieve context
user_context = client.thread.get_user_context(
    thread_id="thread_id",
    template_id="customer-support"
)
context_block = user_context.context
```

```typescript TypeScript
import { Zep } from "@getzep/zep-cloud";

const client = new Zep({ apiKey: "YOUR_API_KEY" });

// Create a custom template
await client.context.createContextTemplate({
    templateId: "customer-support",
    template: `# CUSTOMER PROFILE
%{user_summary}

# FACTS
%{edges limit=10}

# KEY ENTITIES
%{entities limit=5}`
});

// Use the template to retrieve context
const userContext = await client.thread.getUserContext("thread_id", {
    templateId: "customer-support"
});
const contextBlock = userContext.context;
```

```go Go
import (
    "context"
    zep "github.com/getzep/zep-go/v3"
    zepclient "github.com/getzep/zep-go/v3/context"
    threadclient "github.com/getzep/zep-go/v3/thread/client"
    "github.com/getzep/zep-go/v3/option"
)

contextClient := zepclient.NewClient(
    option.WithAPIKey("YOUR_API_KEY"),
)

threadClient := threadclient.NewClient(
    option.WithAPIKey("YOUR_API_KEY"),
)

// Create a custom template
_, err := contextClient.CreateContextTemplate(
    context.TODO(),
    &zep.CreateContextTemplateRequest{
        TemplateID: "customer-support",
        Template: `# CUSTOMER PROFILE
%{user_summary}

# FACTS
%{edges limit=10}

# KEY ENTITIES
%{entities limit=5}`,
    },
)

// Use the template to retrieve context
templateID := "customer-support"
userContext, err := threadClient.GetUserContext(
    context.TODO(),
    "thread_id",
    &zep.ThreadGetUserContextRequest{
        TemplateID: &templateID,
    },
)
contextBlock := userContext.Context

--- zep-docs://searching-the-graph ---
> For clean Markdown of any page, append .md to the page URL.
> For a complete documentation index, see https://help.getzep.com/llms.txt.
> For AI client integration (Claude Code, Cursor, etc.), connect to the MCP server at https://help.getzep.com/_mcp/server.

# Searching the Graph

Graph search results should be used in conjunction with [Advanced Context Block Construction](/cookbook/advanced-context-block-construction) to create contextual prompts for AI models. Custom context blocks allow you to format and structure the retrieved graph information, combining search results with conversation history and other relevant data to provide context for your AI applications.

Learn how to integrate graph search results into your context generation workflow for grounded responses.

## Introduction

Zep's graph search combines semantic similarity with BM25 full-text search to find relevant information across your knowledge graph. It uses semantic understanding for conceptual matches and full-text search for exact terms. Additionally, you can optionally enable breadth-first search to bias results toward information connected to specific starting points in your graph.

### How It Works

* **Semantic similarity**: Converts queries into embeddings to find conceptually similar content
* **BM25 full-text search**: Performs traditional keyword-based search for exact matches
* **Breadth-first search** (optional): Biases results toward information connected to specified starting nodes, useful for contextual relevance
* **Hybrid results**: Combines and reranks results using reciprocal rank fusion (RRF)

### Graph Concepts

* **Nodes**: Connection points representing entities (people, places, concepts) discussed in conversations or added via the Graph API
* **Edges**: Relationships between nodes containing specific facts and interactions

The example below demonstrates a simple search:

```python Python
from zep_cloud.client import Zep

client = Zep(
    api_key=API_KEY,
)

search_results = client.graph.search(
    user_id=user_id,
    query=query,
)
```

```typescript TypeScript
import { ZepClient } from "@getzep/zep-cloud";

const client = new ZepClient({
  apiKey: API_KEY,
});

const searchResults = await client.graph.search({
  userId: userId,
  query: query,
});
```

```go Go
import (
    "context"
    "github.com/getzep/zep-go/v3"
    zepclient "github.com/getzep/zep-go/v3/client"
    "github.com/getzep/zep-go/v3/option"
)

client := zepclient.NewClient(
    option.WithAPIKey(API_KEY),
)

searchResults, err := client.Graph.Search(context.TODO(), &zep.GraphSearchQuery{
    UserID: zep.String(userID),
    Query:  query,
})
```

Keep queries short: they are truncated at 400 characters. Long queries may increase latency without improving search quality.
Break down complex searches into smaller, targeted queries. Use precise, contextual queries rather than generic ones

For most assistant use cases, set `scope="auto"` and let Zep dynamically compose the most relevant context across edges, nodes, episodes, observations, and thread summaries into a single ready-to-use block. See [Auto Search](#auto-search) below.

## Auto Search

Auto search is the recommended entry point to graph retrieval. Instead of asking you to pre-commit to a single result type — facts, entity summaries, raw messages, observations, or thread summaries — auto search retrieves across all of them in parallel, applies a cross-scope rerank, and dynamically composes the most relevant results into a single context block sized to a character budget you control.

The output is a drop-in string you can paste straight into your LLM prompt. There is no client-side stitching, no scope-picking heuristic to maintain, and no need to make multiple search calls to cover different data shapes.

### What auto search does

* **Composes across all data shapes in one call.** A single query returns the most relevant material whether it lives in graph facts, entity summaries, raw episodes, derived observations, or per-thread summaries.
* **Ranks globally, not per-scope.** Auto search applies its own internal cross-scope rerank so results are ordered by overall relevance to the query — a strong observation can outrank a weaker edge, and vice versa.
* **Packs to a character budget.** The returned context block is materialized to fit within `max_characters`, giving you predictable, prompt-window-friendly output.
* **Returns a ready-to-use context block.** The `context` field is the primary output: a formatted string designed to be inserted directly into a system prompt or message.
* **Optionally exposes the underlying results.** Set `return_raw_results=true` to also receive the selected items as typed arrays — useful for inspection, citation, or building custom context blocks on top of auto's selection.

### How to use it

Set `scope="auto"` and (optionally) `max_characters` to bound the size of the returned context block. `max_characters` defaults to `2500` and is capped at `50000`. Zep selects results across scopes, applies its internal cross-scope rerank, and packs the top-ranked results into the context block until the character budget is reached.

```python Python
from zep_cloud.client import Zep

client = Zep(
    api_key=API_KEY,
)

search_results = client.graph.search(
    user_id=user_id,
    query="What did we decide about the pricing rollout?",
    scope="auto",
    max_characters=2500,
)

# The materialized context block, ready to drop into a prompt
print(search_results.context)
```

```typescript TypeScript
import { ZepClient } from "@getzep/zep-cloud";

const client = new ZepClient({
  apiKey: API_KEY,
});

const searchResults = await client.graph.search({
  userId: userId,
  query: "What did we decide about the pricing rollout?",
  scope: "auto",
  maxCharacters: 2500,
});

// The materialized context block, ready to drop into a prompt
console.log(searchResults.context);
```

```go Go
import (
    "context"
    "github.com/getzep/zep-go/v3"
    zepclient "github.com/getzep/zep-go/v3/client"
    "github.com/getzep/zep-go/v3/option"
)

client := zepclient.NewClient(
    option.WithAPIKey(API_KEY),
)

searchResults, err := client.Graph.Search(context.TODO(), &zep.GraphSearchQuery{
    UserID:        zep.String(userID),
    Query:         "What did we decide about the pricing rollout?",
    Scope:         zep.GraphSearchScopeAuto.Ptr(),
    MaxCharacters: zep.Int(2500),
})
```

### When to use auto vs. a specific scope

| Use auto when...                                                | Use a specific scope when...                                                |
| --------------------------------------------------------------- | --------------------------------------------------------------------------- |
| You want the best available context for an arbitrary user query | You know exactly which data shape you need (e.g. just facts, just entities) |
| The right result type varies query-by-query                     | You're driving a UI that renders one result type (e.g. an entity browser)   |
| You want a ready-to-prompt context block                        | You need to programmatically merge results with other data                  |
| You want Zep to manage cross-scope ranking for you              | You need fine-grained control over reranker, filters, or BFS per scope      |

### Response format

Auto search returns a `GraphSearchResults` object with two parts:

* **`context`** *(string)* — A single materialized context block composed from the highest-ranked results across scopes, packed up to `max_characters`. This is the primary output of auto search and is intended to be passed directly to your LLM. With other scopes, `context` is empty; with `scope="auto"` it is always populated.
* **Raw selected results** *(arrays)* — When `return_raw_results=true`, the response also includes the underlying selected results as typed arrays: `edges`, `nodes`, `episodes`, `observations`, and `thread_summaries`. Only the 

--- zep-docs://graph-overview ---
> For clean Markdown of any page, append .md to the page URL.
> For a complete documentation index, see https://help.getzep.com/llms.txt.
> For AI client integration (Claude Code, Cursor, etc.), connect to the MCP server at https://help.getzep.com/_mcp/server.

# Graph Overview

Zep's temporal knowledge graph powers its context engineering capabilities, including agent memory and Graph RAG. Zep's graph is built on [Graphiti](/graphiti/graphiti/overview), Zep's open-source temporal graph library, which is fully integrated into Zep. Developers do not need to interact directly with Graphiti or understand its underlying implementation.

A knowledge graph is a network of interconnected facts, such as *"Kendra loves
Adidas shoes."* Each fact is a *"triplet"* represented by two entities, or
nodes (*"Kendra", "Adidas shoes"*), and their relationship, or edge
(*"loves"*).

<br />

Knowledge Graphs have been explored extensively for information retrieval.
Zep autonomously builds temporal knowledge graphs, handling changing relationships
and maintaining historical context.

Zep automatically constructs a temporal knowledge graph for each of your users. The knowledge graph contains entities, relationships, and facts related to your user, while automatically handling changing relationships and facts over time.

Here's an example of how Zep might extract graph data from a chat message, and then update the graph once new information is available:

<img src="https://files.buildwithfern.com/zep.docs.buildwithfern.com/2026-07-09T02:35:12.152Z/images/graphiti-graph-intro.gif" alt="graphiti intro slides" />

Each node and edge contains certain attributes - notably, a fact is always stored as an edge attribute. There are also datetime attributes for when the fact becomes valid and when it becomes invalid.

## Graph Data Structure

Zep's graph database stores data in three main types:

1. Entity edges (edges): Represent relationships between nodes and include semantic facts representing the relationship between the edge's nodes.
2. Entity nodes (nodes): Represent entities extracted from episodes, containing summaries of relevant information.
3. Episodic nodes (episodes): Represent raw data stored in Zep, either through chat history or the `graph.add` endpoint.

## Working with the Graph

To learn more about interacting with Zep's graph, refer to the following sections:

* [Adding Data to the Graph](./adding-data-to-the-graph.mdx): Learn how to add new data to the graph.
* [Reading Data from the Graph](./reading-data-from-the-graph.mdx): Discover how to retrieve information from the graph.
* [Searching the Graph](./searching-the-graph.mdx): Explore techniques for efficiently searching the graph.

These guides will help you use Zep's knowledge graph in your applications.