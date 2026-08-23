/**
 * Merkle root computation from bytes, decoupled from file upload.
 *
 * This module exists separate from `upload.ts` because a browser needs to recompute
 * a merkle root to verify a published measurement, and it must not have to load the
 * upload path — which carries a wallet, an RPC client, and indexer logic — just to
 * hash some bytes. Only `MemData` crosses the boundary to this module; everything
 * else stays on the write side.
 *
 * Non-webpack bundlers (Vite, esbuild) do not honour `webpackIgnore` comments on
 * dynamic imports, so entangling this with the upload path would break the dashboard
 * build when Task 7 imports `merkleRootOf` into browser code.
 */
// The SDK's package exports offer two entries and neither works here. The default "." is a
// barrel that re-exports Indexer, ZgFile and Downloader, so importing anything from it drags
// the whole node-only upload path into a browser bundle. The "./browser" entry is not in fact
// browser-safe — it still fails to resolve fs, path and node:fs/promises. MemData's own module
// bundles clean at 53 KB, but the exports map refuses a subpath specifier, so the only way to
// reach it is by real path. Worth reporting to 0G DevRel alongside the other SDK issues.
// The bundling test in src/verify/test/browser-safe.test.ts is what keeps this honest.
import { MemData } from '../../node_modules/@0gfoundation/0g-storage-ts-sdk/lib.esm/file/MemData.js';

export class MerkleFailed extends Error {}

/**
 * Merkle root of some bytes, derived locally and without touching a filesystem.
 *
 * The verifier needs this: fetching by root proves only that a gateway answered to that
 * root, and a hostile gateway could answer with anything. Recomputing the root over the
 * bytes actually received is what binds them to the record on chain.
 *
 * `MemData` rather than `ZgFile` because the same check has to run in a browser, where
 * there is no file path. Verified 2026-08-23 to produce an identical root.
 */
export async function merkleRootOf(bytes: string | Uint8Array): Promise<string> {
  const data = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes;
  const [tree, err] = await new MemData(data).merkleTree();
  const root = tree?.rootHash();
  if (err || !root) throw new MerkleFailed(`merkle tree failed: ${err?.message}`);
  return root;
}
