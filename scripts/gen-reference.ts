/**
 * gen-reference.ts
 *
 * Reads JSON data files produced by sync-nips.ts (from scripts/data/) and
 * generates Starlight MDX reference pages under src/content/docs/reference/.
 *
 * Usage:
 *   npx tsx scripts/gen-reference.ts
 *
 * If the JSON data files don't exist yet (sync-nips hasn't run), the script
 * uses hardcoded fallback sample data so it still works.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const ROOT = resolve(import.meta.dirname ?? ".", "..");
const DATA_DIR = resolve(ROOT, "scripts/data");
const OUTPUT_DIR = resolve(ROOT, "src/content/docs/reference");

// ---------------------------------------------------------------------------
// Fallback sample data (used when sync-nips hasn't run yet)
// ---------------------------------------------------------------------------

const FALLBACK_NIPS_INDEX = [
  { number: "01", title: "Basic protocol flow description", href: "01.md" },
  { number: "02", title: "Follow List", href: "02.md" },
  { number: "09", title: "Event Deletion Request", href: "09.md" },
  { number: "10", title: "Text Notes and Threads", href: "10.md" },
  { number: "18", title: "Reposts", href: "18.md" },
  { number: "25", title: "Reactions", href: "25.md" },
  { number: "28", title: "Public Chat", href: "28.md" },
  { number: "42", title: "Authentication of clients to relays", href: "42.md" },
  { number: "45", title: "Counting results", href: "45.md" },
  { number: "51", title: "Lists", href: "51.md" },
  { number: "57", title: "Lightning Zaps", href: "57.md" },
  { number: "59", title: "Gift Wrap", href: "59.md" },
  { number: "65", title: "Relay List Metadata", href: "65.md" },
];

const FALLBACK_EVENT_KINDS = [
  { kind: "`0`", description: "User Metadata", NIP: "[01](01.md)" },
  { kind: "`1`", description: "Short Text Note", NIP: "[01](01.md)" },
  { kind: "`3`", description: "Follows", NIP: "[02](02.md)" },
  { kind: "`4`", description: "Encrypted Direct Messages", NIP: "[04](04.md)" },
  { kind: "`5`", description: "Event Deletion Request", NIP: "[09](09.md)" },
  { kind: "`6`", description: "Repost", NIP: "[18](18.md)" },
  { kind: "`7`", description: "Reaction", NIP: "[25](25.md)" },
  { kind: "`40`", description: "Channel Creation", NIP: "[28](28.md)" },
  { kind: "`41`", description: "Channel Metadata", NIP: "[28](28.md)" },
  { kind: "`42`", description: "Channel Message", NIP: "[28](28.md)" },
  { kind: "`1984`", description: "Reporting", NIP: "[56](56.md)" },
  { kind: "`9734`", description: "Zap Request", NIP: "[57](57.md)" },
  { kind: "`9735`", description: "Zap", NIP: "[57](57.md)" },
  { kind: "`10000`", description: "Mute list", NIP: "[51](51.md)" },
  { kind: "`10002`", description: "Relay List Metadata", NIP: "[65](65.md), [51](51.md)" },
  { kind: "`22242`", description: "Client Authentication", NIP: "[42](42.md)" },
  { kind: "`30023`", description: "Long-form Content", NIP: "[23](23.md)" },
];

const FALLBACK_TAGS = [
  { name: "`e`", value: "event id (hex)", "other parameters": "relay URL, marker", NIP: "[01](01.md), [10](10.md)" },
  { name: "`p`", value: "pubkey (hex)", "other parameters": "relay URL, petname", NIP: "[01](01.md), [02](02.md)" },
  { name: "`a`", value: "coordinates to an event", "other parameters": "relay URL", NIP: "[01](01.md)" },
  { name: "`d`", value: "identifier", "other parameters": "--", NIP: "[01](01.md)" },
  { name: "`t`", value: "hashtag", "other parameters": "--", NIP: "[24](24.md)" },
  { name: "`r`", value: "a reference (URL, etc)", "other parameters": "--", NIP: "[24](24.md), [25](25.md)" },
  { name: "`expiration`", value: "unix timestamp (string)", "other parameters": "--", NIP: "[40](40.md)" },
  { name: "`subject`", value: "subject", "other parameters": "--", NIP: "[14](14.md)" },
  { name: "`nonce`", value: "random", "other parameters": "difficulty", NIP: "[13](13.md)" },
  { name: "`amount`", value: "millisatoshis, stringified", "other parameters": "--", NIP: "[57](57.md)" },
  { name: "`bolt11`", value: "bolt11 invoice", "other parameters": "--", NIP: "[57](57.md)" },
  { name: "`content-warning`", value: "reason", "other parameters": "--", NIP: "[36](36.md)" },
  { name: "`alt`", value: "summary", "other parameters": "--", NIP: "[31](31.md)" },
  { name: "`imeta`", value: "inline metadata", "other parameters": "--", NIP: "[92](92.md)" },
];

const FALLBACK_MESSAGE_TYPES = {
  clientMessages: [
    { type: "`EVENT`", description: "used to publish events", NIP: "[01](01.md)" },
    { type: "`REQ`", description: "used to request events and subscribe to new updates", NIP: "[01](01.md)" },
    { type: "`CLOSE`", description: "used to stop previous subscriptions", NIP: "[01](01.md)" },
    { type: "`AUTH`", description: "used to send authentication events", NIP: "[42](42.md)" },
    { type: "`COUNT`", description: "used to request event counts", NIP: "[45](45.md)" },
  ],
  relayMessages: [
    { type: "`EOSE`", description: "used to notify clients all stored events have been sent", NIP: "[01](01.md)" },
    { type: "`EVENT`", description: "used to send events requested to clients", NIP: "[01](01.md)" },
    { type: "`NOTICE`", description: "used to send human-readable messages to clients", NIP: "[01](01.md)" },
    { type: "`OK`", description: "used to notify clients if an EVENT was successful", NIP: "[01](01.md)" },
    { type: "`CLOSED`", description: "used to notify clients that a REQ was ended and why", NIP: "[01](01.md)" },
    { type: "`AUTH`", description: "used to send authentication challenges", NIP: "[42](42.md)" },
    { type: "`COUNT`", description: "used to send requested event counts to clients", NIP: "[45](45.md)" },
  ],
};

// ---------------------------------------------------------------------------
// Data loading with fallback
// ---------------------------------------------------------------------------

function loadJson<T>(filename: string, fallback: T): T {
  const filepath = join(DATA_DIR, filename);
  if (existsSync(filepath)) {
    try {
      const raw = readFileSync(filepath, "utf-8");
      return JSON.parse(raw) as T;
    } catch (err) {
      console.warn(`[gen-reference] WARN: Failed to read ${filepath}, using fallback data`);
      console.warn(`  ${err}`);
      return fallback;
    }
  }
  console.warn(`[gen-reference] WARN: ${filepath} not found, using fallback data`);
  console.warn(`  Run 'npx tsx scripts/sync-nips.ts' first to get live data.`);
  return fallback;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface EventKindEntry {
  kind: string;
  description: string;
  NIP: string;
}

interface TagEntry {
  name: string;
  value: string;
  "other parameters"?: string;
  NIP: string;
}

interface MessageEntry {
  type: string;
  description: string;
  NIP: string;
}

interface MessageTypes {
  clientMessages: MessageEntry[];
  relayMessages: MessageEntry[];
}

/** Strip markdown backticks from a string. */
function stripBackticks(s: string): string {
  return s.replace(/^`+|`+$/g, "");
}

/**
 * Convert NIP references like "[01](01.md)" or "[51](51.md), [58](58.md)"
 * into MDX links pointing to /nips/XX pages.
 * Handles formats:
 *   - [01](01.md) → [NIP-01](/nips/01)
 *   - 01 (deprecated) → NIP-01
 *   - [Marmot][marmot] → left as-is (external)
 *   - [NKBIP-03] → left as-is
 *   - empty string → —
 */
function nipToMdxLink(nipStr: string): string {
  if (!nipStr || nipStr.trim() === "") return "—";

  // Split on comma to handle multiple NIP refs
  const parts = nipStr.split(",").map((p) => p.trim()).filter(Boolean);

  return parts
    .map((part) => {
      // Match [XX](XX.md) pattern
      const mdLinkMatch = part.match(/\[(\w+)\]\((\w+)\.md\)/);
      if (mdLinkMatch) {
        const num = mdLinkMatch[1];
        return `[NIP-${num}](/nips/${num})`;
      }

      // Match plain "XX (deprecated)" or just a number like "01 (deprecated)"
      const plainNum = part.match(/^(\d{1,2}[A-Za-z]?)\s*(\(.*\))?$/);
      if (plainNum) {
        const num = plainNum[1];
        const suffix = plainNum[2] || "";
        return `[NIP-${num}](/nips/${num})${suffix ? " " + suffix : ""}`;
      }

      // External/nonstandard refs like [Marmot][marmot], [NKBIP-03], etc. — leave as-is
      return part;
    })
    .join(", ");
}

/**
 * Extract the leading numeric value from a kind string like "`0`", "`9735`",
 * or a range like "`5000`-`5999`". Returns the first number for sorting.
 */
function kindSortValue(kind: string): number {
  const cleaned = stripBackticks(kind);
  const match = cleaned.match(/^(\d+)/);
  return match ? parseInt(match[1], 10) : 0;
}

/**
 * Categorize a kind number into one of the NIP-01 ranges:
 *   0-9999    → Regular
 *   10000-19999 → Replaceable
 *   20000-29999 → Ephemeral
 *   30000-39999 → Addressable
 */
type KindCategory = "Regular" | "Replaceable" | "Ephemeral" | "Addressable";

function categorizeKind(num: number): KindCategory {
  if (num >= 30000 && num <= 39999) return "Addressable";
  if (num >= 20000 && num <= 29999) return "Ephemeral";
  if (num >= 10000 && num <= 19999) return "Replaceable";
  return "Regular";
}

/**
 * Escape a table cell value for MDX (pipes must be escaped).
 */
function escCell(s: string): string {
  return s.replace(/\|/g, "\\|");
}

// ---------------------------------------------------------------------------
// Page generators
// ---------------------------------------------------------------------------

function generateEventKindsPage(entries: EventKindEntry[]): string {
  // Sort by kind number
  const sorted = [...entries].sort((a, b) => kindSortValue(a.kind) - kindSortValue(b.kind));

  // Group by category
  const groups = new Map<KindCategory, EventKindEntry[]>();
  const order: KindCategory[] = ["Regular", "Replaceable", "Ephemeral", "Addressable"];
  for (const cat of order) groups.set(cat, []);

  for (const entry of sorted) {
    const num = kindSortValue(entry.kind);
    const cat = categorizeKind(num);
    groups.get(cat)!.push(entry);
  }

  let mdx = `---
title: Event Kinds Reference
description: Complete reference of all Nostr event kinds grouped by category.
---

Every Nostr event has a **kind** field that indicates what type of data it carries.
The kind number also determines how relays should handle the event — whether it is
permanent, replaceable, ephemeral, or addressable.

The kind ranges defined in NIP-01 are:

- **0 – 9999**: Regular events (stored permanently)
- **10000 – 19999**: Replaceable events (only the latest from each author is kept)
- **20000 – 29999**: Ephemeral events (not stored by relays)
- **30000 – 39999**: Addressable events (replaceable by \`d\` tag + kind + pubkey)

`;

  for (const cat of order) {
    const items = groups.get(cat)!;
    if (items.length === 0) continue;

    mdx += `## ${cat} Events\n\n`;
    mdx += `| Kind | Description | Defined In |\n`;
    mdx += `| ---- | ----------- | ---------- |\n`;

    for (const entry of items) {
      const kind = escCell(stripBackticks(entry.kind));
      const desc = escCell(entry.description);
      const nip = escCell(nipToMdxLink(entry.NIP));
      mdx += `| ${kind} | ${desc} | ${nip} |\n`;
    }

    mdx += "\n";
  }

  return mdx;
}

function generateTagsPage(entries: TagEntry[]): string {
  // Sort alphabetically by tag name
  const sorted = [...entries].sort((a, b) =>
    stripBackticks(a.name).localeCompare(stripBackticks(b.name))
  );

  let mdx = `---
title: Standard Tags Reference
description: Complete reference of all standard Nostr event tags.
---

Nostr events carry structured data in their **tags** array. Each tag is a
JSON array where the first element is the tag name and subsequent elements
are tag-specific values.

The table below lists all standardised tags defined across NIPs.

`;

  mdx += `| Tag Name | Value Description | Defined In |\n`;
  mdx += `| -------- | ---------------- | ---------- |\n`;

  for (const entry of sorted) {
    const name = escCell(stripBackticks(entry.name));
    const value = escCell(entry.value);
    const nip = escCell(nipToMdxLink(entry.NIP));
    mdx += `| ${name} | ${value} | ${nip} |\n`;
  }

  mdx += "\n";
  return mdx;
}

function generateMessageTypesPage(data: MessageTypes): string {
  let mdx = `---
title: Message Types Reference
description: Complete reference of all Nostr client-relay protocol messages.
---

Nostr clients and relays communicate over WebSocket connections using
JSON-arrays.  Each message is identified by its type string.  The tables
below list every standardised message type.

`;

  // Client → Relay
  mdx += `## Client → Relay Messages\n\n`;
  mdx += `These messages are sent from clients to relays.\n\n`;
  mdx += `| Type | Description | Defined In |\n`;
  mdx += `| ---- | ----------- | ---------- |\n`;

  for (const entry of data.clientMessages) {
    const type = escCell(stripBackticks(entry.type));
    const desc = escCell(entry.description);
    const nip = escCell(nipToMdxLink(entry.NIP));
    mdx += `| ${type} | ${desc} | ${nip} |\n`;
  }

  mdx += "\n";

  // Relay → Client
  mdx += `## Relay → Client Messages\n\n`;
  mdx += `These messages are sent from relays to clients.\n\n`;
  mdx += `| Type | Description | Defined In |\n`;
  mdx += `| ---- | ----------- | ---------- |\n`;

  for (const entry of data.relayMessages) {
    const type = escCell(stripBackticks(entry.type));
    const desc = escCell(entry.description);
    const nip = escCell(nipToMdxLink(entry.NIP));
    mdx += `| ${type} | ${desc} | ${nip} |\n`;
  }

  mdx += "\n";
  return mdx;
}

function generateIndexPage(): string {
  return `---
title: Reference
description: Quick-reference documentation for Nostr event kinds, tags, and protocol messages.
template: splash
---

import { Card, CardGrid } from "@astrojs/starlight/components";

The reference section provides structured, look-up-friendly tables of the core
Nostr protocol primitives: event kinds, standard tags, and the client-relay
message protocol.

<CardGrid>
  <Card title="Event Kinds" href="/reference/event-kinds">
    All known event kinds grouped by category — regular, replaceable,
    ephemeral, and addressable.
  </Card>
  <Card title="Standard Tags" href="/reference/tags">
    Every standardised tag name, what its value represents, and which
    NIP defines it.
  </Card>
  <Card title="Message Types" href="/reference/message-types">
    Client-to-relay and relay-to-client WebSocket messages that make
    up the Nostr protocol.
  </Card>
</CardGrid>
`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  console.log("[gen-reference] Loading data...");

  const eventKinds = loadJson<EventKindEntry[]>("event-kinds.json", FALLBACK_EVENT_KINDS);
  const tags = loadJson<TagEntry[]>("common-tags.json", FALLBACK_TAGS);
  const messageTypes = loadJson<MessageTypes>("message-types.json", FALLBACK_MESSAGE_TYPES);

  // Ensure output directory exists
  mkdirSync(OUTPUT_DIR, { recursive: true });

  // Generate pages
  console.log("[gen-reference] Generating event-kinds.mdx...");
  writeFileSync(join(OUTPUT_DIR, "event-kinds.mdx"), generateEventKindsPage(eventKinds));

  console.log("[gen-reference] Generating tags.mdx...");
  writeFileSync(join(OUTPUT_DIR, "tags.mdx"), generateTagsPage(tags));

  console.log("[gen-reference] Generating message-types.mdx...");
  writeFileSync(join(OUTPUT_DIR, "message-types.mdx"), generateMessageTypesPage(messageTypes));

  console.log("[gen-reference] Generating index.mdx...");
  writeFileSync(join(OUTPUT_DIR, "index.mdx"), generateIndexPage());

  console.log("[gen-reference] Done! Generated 4 pages in " + OUTPUT_DIR);
}

main();
