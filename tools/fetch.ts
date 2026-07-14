/**
 * Fetch Nexperia datasheet PDFs by part number.
 *
 * The asset host serves a deterministic URL keyed on the part number:
 *   https://assets.nexperia.com/documents/data-sheet/<PART>.pdf
 *
 * Two things this script exists to handle:
 *
 * 1. A bare curl/fetch gets 403 from Akamai. A browser User-Agent gets 200.
 *    This is not a bypass of an access control (the PDFs are public product
 *    documentation with no login); it is the host refusing an empty UA.
 *
 * 2. The part list from the selection guide is candidates, not facts. A 404 is
 *    the authoritative answer that a candidate is not a real part, so 404s are
 *    expected, counted, and dropped without noise.
 *
 * Concurrency is deliberately low. We are a guest on someone else's CDN.
 */

const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const BASE = "https://assets.nexperia.com/documents/data-sheet";
const CONCURRENCY = 4;
const DELAY_MS = 250;

const listPath = process.argv[2];
const outDir = process.argv[3];
if (!listPath || !outDir) {
  console.error("usage: bun tools/fetch.ts <parts.txt> <out-dir>");
  process.exit(1);
}

const parts = (await Bun.file(listPath).text()).split("\n").map((l) => l.trim()).filter(Boolean);
await Bun.$`mkdir -p ${outDir}`.quiet();

let ok = 0;
let missing = 0;
let failed = 0;
let done = 0;

async function fetchOne(part: string): Promise<void> {
  const target = `${outDir}/${part}.pdf`;
  if (await Bun.file(target).exists()) {
    ok++;
    return;
  }

  try {
    const response = await fetch(`${BASE}/${part}.pdf`, { headers: { "User-Agent": UA } });
    if (response.status === 404) {
      missing++;
      return;
    }
    if (!response.ok) {
      failed++;
      console.error(`${part}: HTTP ${response.status}`);
      return;
    }
    const type = response.headers.get("content-type") ?? "";
    if (!type.includes("pdf")) {
      failed++;
      console.error(`${part}: not a pdf (${type})`);
      return;
    }
    await Bun.write(target, await response.arrayBuffer());
    ok++;
  } catch (error) {
    failed++;
    console.error(`${part}: ${String(error)}`);
  } finally {
    done++;
    if (done % 25 === 0) {
      console.error(`${done}/${parts.length} — ${ok} ok, ${missing} missing, ${failed} failed`);
    }
  }
}

// A fixed pool of workers pulling from one shared cursor. Keeps exactly
// CONCURRENCY requests in flight regardless of how the per-request latency
// varies, which a chunked Promise.all does not.
let cursor = 0;
async function worker(): Promise<void> {
  while (cursor < parts.length) {
    const part = parts[cursor++];
    await fetchOne(part);
    await Bun.sleep(DELAY_MS);
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, worker));
console.error(`\ndone: ${ok} fetched, ${missing} no such part (404), ${failed} failed`);

export {};
