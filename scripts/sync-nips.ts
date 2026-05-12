/**
 * sync-nips.ts
 *
 * Fetches NIP markdown files from https://github.com/nostr-protocol/nips,
 * converts them to Starlight MDX pages with frontmatter, and extracts
 * reference tables from README.md into JSON files.
 *
 * Usage:
 *   npx tsx scripts/sync-nips.ts          # incremental sync
 *   npx tsx scripts/sync-nips.ts --force    # re-download everything
 *
 * No external dependencies — uses only Node built-in fetch.
 */

import { writeFileSync, readFileSync, mkdirSync, existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const GITHUB_API = "https://api.github.com/repos/nostr-protocol/nips";
const GITHUB_RAW = "https://raw.githubusercontent.com/nostr-protocol/nips/master";
const NIP_FILE_RE = /^(\d{1,2}[A-Za-z]?)\.md$/;

const ROOT = resolve(import.meta.dirname ?? ".", "..");
const OUTPUT_NIPS_DIR = resolve(ROOT, "src/content/docs/nips");
const DATA_DIR = resolve(ROOT, "scripts/data");
const CACHE_FILE = join(DATA_DIR, ".sync-cache.json");

const DELAY_MS = 350; // ms between GitHub API requests
const force = process.argv.includes("--force");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

function log(msg: string) {
  console.log(`[sync-nips] ${msg}`);
}

function warn(msg: string) {
  console.warn(`[sync-nips] WARN: ${msg}`);
}

/** Small fetch wrapper that checks rate-limit headers. */
async function githubFetch(url: string, isRaw = false): Promise<{ text: string; lastModified?: string }> {
  const headers: Record<string, string> = {
    "User-Agent": "nostr-docs-sync/1.0",
  };
  if (!isRaw) {
    headers.Accept = "application/vnd.github.v3+json";
  }

  const res = await fetch(url, { headers });

  // Rate-limit guard
  const remaining = res.headers.get("x-ratelimit-remaining");
  const reset = res.headers.get("x-ratelimit-reset");
  if (remaining && Number(remaining) < 5 && reset) {
    const waitSec = Math.max(Number(reset) - Math.floor(Date.now() / 1000), 1);
    warn(`GitHub rate limit almost exhausted (${remaining} remaining). Sleeping ${waitSec}s until reset.`);
    await sleep(waitSec * 1000);
    // retry once
    return githubFetch(url, isRaw);
  }

  if (res.status === 403) {
    const retryAfter = res.headers.get("retry-after");
    const wait = retryAfter ? Number(retryAfter) * 1000 : 60_000;
    warn(`403 Forbidden — likely secondary rate limit. Sleeping ${wait / 1000}s.`);
    await sleep(wait);
    return githubFetch(url, isRaw);
  }

  if (!res.ok) {
    throw new Error(`GET ${url} → ${res.status} ${res.statusText}`);
  }

  return {
    text: await res.text(),
    lastModified: res.headers.get("last-modified") ?? undefined,
  };
}

// ---------------------------------------------------------------------------
// Cache helpers
// ---------------------------------------------------------------------------

interface SyncCache {
  /** "filename.md": last-modified header value */
  [k: string]: string;
}

function loadCache(): SyncCache {
  if (force || !existsSync(CACHE_FILE)) return {};
  try {
    return JSON.parse(readFileSync(CACHE_FILE, "utf-8"));
  } catch {
    return {};
  }
}

function saveCache(cache: SyncCache) {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
}

// ---------------------------------------------------------------------------
// NIP status parsing
// ---------------------------------------------------------------------------

interface NipMeta {
  number: string; // e.g. "01", "5A"
  title: string;
  slug: string;
  status: string; // draft | final | deprecated | unknown
  layer: string;  // mandatory | optional | unknown
  description: string;
}

const STATUS_RE = /\bdraft\b|\bfinal\b|\bdeprecated\b/i;
const LAYER_RE = /\b(mandatory|optional)\b/i;

function parseFrontMatterFromMd(md: string, filename: string): NipMeta {
  const number = filename.replace(/\.md$/, "");
  const slug = `nip-${number.toLowerCase()}`;
  const lines = md.split("\n");

  let status = "unknown";
  let layer = "unknown";
  let title = "";

  const headLines = lines.slice(0, 50);

  // --- Step 1: Collect all headings from the top of the file ---
  const headings: Array<{ text: string; level: number }> = [];
  for (let i = 0; i < headLines.length; i++) {
    const trimmed = headLines[i].trim();
    // Underline-style heading: text followed by === or ---
    if (
      i + 1 < headLines.length &&
      /^[=\-]{3,}$/.test(headLines[i + 1].trim()) &&
      trimmed.length > 0
    ) {
      const level = headLines[i + 1].trim()[0] === "=" ? 1 : 2;
      headings.push({ text: trimmed.replace(/\*+/g, "").trim(), level });
    }
    // # style heading
    const hm = trimmed.match(/^(#{1,4})\s+(.+)/);
    if (hm) {
      headings.push({ text: hm[2].replace(/\*+/g, "").trim(), level: hm[1].length });
    }
  }

  // Pick the best title: if the first heading is just "NIP-XX", use the next one
  if (headings.length > 0) {
    const first = headings[0].text;
    if (/^NIP-?\d+[A-Za-z]?$/.test(first) && headings.length > 1) {
      title = headings[1].text;
    } else {
      title = first;
    }
  }

  // --- Step 2: Scan first ~30 non-empty lines for status and layer tags ---
  // Prefer backtick-wrapped tags like `draft` `mandatory` over prose mentions
  let scanned = 0;
  for (let i = 0; i < headLines.length && scanned < 30; i++) {
    const trimmed = headLines[i].trim();
    if (!trimmed) continue;
    scanned++;

    // Skip underline lines
    if (/^[=\-]{3,}$/.test(trimmed)) continue;

    // Only parse tags from lines that contain backtick-wrapped words (the standard NIP format)
    // e.g.  `draft` `mandatory` `relay`
    const hasBacktickTags = /`[^`]+`/.test(trimmed);

    if (hasBacktickTags) {
      // Remove backticks for regex matching
      const plain = trimmed.replace(/`/g, "");
      if (STATUS_RE.test(plain)) {
        const m = plain.match(STATUS_RE);
        if (m) status = m[0].toLowerCase();
      }
      const layerMatch = plain.match(LAYER_RE);
      if (layerMatch) layer = layerMatch[1].toLowerCase();
    }
  }

  // Fallback title search deeper in file
  if (!title) {
    for (const line of lines) {
      const m = line.match(/^#+\s+(.+)/);
      if (m) {
        title = m[1].replace(/\*+/g, "").trim();
        break;
      }
    }
  }

  if (!title) {
    title = `NIP-${number}`;
  }

  // Remove leading "NIP-XX:" or "NIP-XX -" prefixes from title for cleanliness
  title = title.replace(/^NIP-?\d+\s*[:\-.]\s*/i, "").trim() || `NIP-${number}`;

  const description = `NIP-${number}: ${title}`;
  return { number, title, slug, status, layer, description };
}

function buildMdx(meta: NipMeta, body: string): string {
  // Starlight frontmatter
  const fm = [
    "---",
    `title: "NIP-${meta.number}: ${meta.title}"`,
    `description: "${meta.description.replace(/"/g, '\\"')}"`,
    `slug: "${meta.slug}"`,
    `nip: ${meta.number}`,
    `status: "${meta.status}"`,
    `layer: "${meta.layer}"`,
    "---",
    "",
  ].join("\n");

  return fm + body;
}

// ---------------------------------------------------------------------------
// README table/list extraction
// ---------------------------------------------------------------------------

interface TableRow {
  [col: string]: string;
}

function parseMarkdownTable(md: string, sectionHeading: string): TableRow[] {
  const lines = md.split("\n");
  let inSection = false;
  let headerRow: string[] | null = null;
  const rows: TableRow[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Detect section heading
    if (/^#{1,4}\s+/.test(line)) {
      inSection = line.toLowerCase().includes(sectionHeading.toLowerCase());
      headerRow = null;
      continue;
    }

    if (!inSection) continue;

    // Skip non-table lines
    if (!line.startsWith("|")) continue;

    // Parse cells
    const cells = line
      .split("|")
      .map((c) => c.trim())
      .filter((_, idx, arr) => idx > 0 && idx < arr.length - 1); // drop empty edges

    // Separator row (|---|---|)
    if (cells.every((c) => /^[-:\s]+$/.test(c))) continue;

    if (!headerRow) {
      headerRow = cells;
      continue;
    }

    if (headerRow) {
      const row: TableRow = {};
      headerRow.forEach((h, idx) => {
        row[h] = cells[idx] ?? "";
      });
      rows.push(row);
    }
  }

  return rows;
}

/**
 * Parse the NIP list from the README "## List" section.
 * Each entry is like: - [NIP-01: Basic protocol flow description](01.md)
 */
interface NipListEntry {
  number: string;
  title: string;
  href: string;
  notes?: string;
}

function parseNipList(md: string): NipListEntry[] {
  const lines = md.split("\n");
  let inList = false;
  const entries: NipListEntry[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    if (/^#{1,4}\s+/.test(trimmed)) {
      inList = trimmed.toLowerCase().includes("list");
      continue;
    }

    if (!inList) continue;

    // Match: - [NIP-XX: Title](XX.md) --- optional notes
    const m = trimmed.match(
      /^-\s+\[NIP-([0-9A-Za-z]+):\s*([^\]]+)\]\(([^)]+)\)(.*)/
    );
    if (m) {
      entries.push({
        number: m[1],
        title: m[2].trim(),
        href: m[3].trim(),
        notes: m[4] ? m[4].replace(/^[-\s]*/, "").trim() || undefined : undefined,
      });
    }
  }

  return entries;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  log(`Starting NIP sync (force=${force})`);
  mkdirSync(OUTPUT_NIPS_DIR, { recursive: true });
  mkdirSync(DATA_DIR, { recursive: true });

  const cache = loadCache();

  // 1. Fetch file listing
  log("Fetching repository contents...");
  const { text: listingJson } = await githubFetch(`${GITHUB_API}/contents/`);
  const listing = JSON.parse(listingJson) as Array<{
    name: string;
    download_url: string | null;
    type: string;
    sha: string;
  }>;

  // 2. Filter NIP .md files
  const nipFiles = listing.filter(
    (f) => f.type === "file" && NIP_FILE_RE.test(f.name)
  );
  log(`Found ${nipFiles.length} NIP files: ${nipFiles.map((f) => f.name).join(", ")}`);

  // 3. Fetch README.md
  log("Fetching README.md...");
  const { text: readmeMd, lastModified: readmeLm } = await githubFetch(`${GITHUB_RAW}/README.md`, true);
  cache["README.md"] = readmeLm ?? new Date().toISOString();

  // Parse README tables
  log("Extracting reference tables from README...");
  const nipList = parseNipList(readmeMd);
  const eventKinds = parseMarkdownTable(readmeMd, "Event Kind");
  const commonTags = parseMarkdownTable(readmeMd, "Common Tag");
  // Message types has sub-sections: "### Client to Relay" and "### Relay to Client"
  const clientMessages = parseMarkdownTable(readmeMd, "Client to Relay");
  const relayMessages = parseMarkdownTable(readmeMd, "Relay to Client");

  writeFileSync(join(DATA_DIR, "nip-index.json"), JSON.stringify(nipList, null, 2));
  writeFileSync(join(DATA_DIR, "event-kinds.json"), JSON.stringify(eventKinds, null, 2));
  writeFileSync(join(DATA_DIR, "common-tags.json"), JSON.stringify(commonTags, null, 2));
  writeFileSync(
    join(DATA_DIR, "message-types.json"),
    JSON.stringify(
      { clientMessages, relayMessages },
      null,
      2
    )
  );
  log("Saved reference table JSON files to scripts/data/");

  // 4. Process each NIP file
  let downloaded = 0;
  let skipped = 0;

  for (const file of nipFiles) {
    const rawUrl = `${GITHUB_RAW}/${file.name}`;
    const cachedLm = cache[file.name];
    const outPath = join(OUTPUT_NIPS_DIR, `nip-${file.name.replace(".md", ".mdx")}`);

    // Check if we can skip (file exists and hasn't changed)
    if (!force && cachedLm && existsSync(outPath)) {
      // We'll do a conditional request if possible; for raw URLs GitHub
      // doesn't always support If-Modified-Since, so we compare length.
      // Simple heuristic: if output exists and cache has entry, skip.
      const stat = statSync(outPath);
      if (stat.size > 0) {
        log(`  SKIP ${file.name} (cached)`);
        skipped++;
        await sleep(50); // minimal delay for skipped files
        continue;
      }
    }

    log(`  FETCH ${file.name} ...`);
    const { text: md, lastModified: lm } = await githubFetch(rawUrl, true);
    cache[file.name] = lm ?? new Date().toISOString();

    // Parse metadata from content
    const meta = parseFrontMatterFromMd(md, file.name);
    const mdx = buildMdx(meta, md);

    writeFileSync(outPath, mdx);
    downloaded++;
    log(`  → wrote ${outPath} (${meta.status}/${meta.layer})`);

    // Rate-limit between actual API calls
    await sleep(DELAY_MS);
  }

  // 5. Save cache
  saveCache(cache);

  log(`\nDone! Downloaded: ${downloaded}, Skipped: ${skipped}`);
}

main().catch((err) => {
  console.error("[sync-nips] FATAL:", err);
  process.exit(1);
});
