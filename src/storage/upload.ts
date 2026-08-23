/**
 * Put an epoch's evidence bundle on 0G Storage and get back the root the chain will carry.
 *
 * The merkle root is computed locally BEFORE the upload and checked against what the
 * indexer reports afterwards. The root is the only path from a seven-integer on-chain
 * summary back to the evidence behind it, so accepting whatever value came back over the
 * network — without having derived it ourselves — would defeat the purpose.
 */
import { Indexer, ZgFile } from '@0gfoundation/0g-storage-ts-sdk';
import { JsonRpcProvider, Wallet } from 'ethers';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export class RootMismatch extends Error {}
export class UploadFailed extends Error {}

/**
 * The indexer's REST gateway. This URL is what makes F7 hold: an independent verifier
 * fetches the evidence with `curl` alone — no SDK to install, no wallet, no key.
 */
export function gatewayUrl(indexerUrl: string, rootHash: string): string {
  return `${indexerUrl.replace(/\/+$/, '')}/file?root=${rootHash}`;
}

export function assertRootMatches(computed: string, reported: string): void {
  if (computed.toLowerCase() === reported.toLowerCase()) return;
  throw new RootMismatch(
    `computed merkle root ${computed} but the indexer reported ${reported}. ` +
      'The root is what the on-chain record points at, so it must be one we derived.',
  );
}

export interface UploadResult {
  rootHash: string;
  txHash: string;
  gatewayUrl: string;
}

/** The `upload` result is one file or a fragmented set; a bundle is one file. */
function firstRoot(r: unknown): { rootHash: string; txHash: string } {
  const o = r as Record<string, unknown>;
  if (typeof o?.rootHash === 'string' && typeof o?.txHash === 'string') {
    return { rootHash: o.rootHash, txHash: o.txHash };
  }
  const roots = o?.rootHashes as string[] | undefined;
  const hashes = o?.txHashes as string[] | undefined;
  if (roots?.length && hashes?.length) return { rootHash: roots[0], txHash: hashes[0] };
  throw new UploadFailed(`could not read a root hash from the upload result: ${JSON.stringify(r)}`);
}

export async function uploadBundle(opts: {
  filePath: string;
  indexerUrl: string;
  rpcUrl: string;
  privateKey: string;
}): Promise<UploadResult> {
  const provider = new JsonRpcProvider(opts.rpcUrl);
  const signer = new Wallet(opts.privateKey, provider);
  const indexer = new Indexer(opts.indexerUrl);

  const file = await ZgFile.fromFilePath(opts.filePath);
  try {
    const [tree, treeErr] = await file.merkleTree();
    if (treeErr || !tree) throw new UploadFailed(`merkle tree failed: ${treeErr?.message}`);
    const computed = tree.rootHash();
    if (!computed) throw new UploadFailed('merkle tree produced no root hash');

    const [res, uploadErr] = await indexer.upload(file, opts.rpcUrl, signer);
    if (uploadErr) throw new UploadFailed(`upload failed: ${uploadErr.message}`);

    const { rootHash, txHash } = firstRoot(res);
    assertRootMatches(computed, rootHash);

    return { rootHash: computed, txHash, gatewayUrl: gatewayUrl(opts.indexerUrl, computed) };
  } finally {
    // Leaking the handle leaks memory, and a long-running prober would accumulate one
    // per epoch.
    await file.close();
  }
}

/**
 * Merkle root of some bytes, derived locally.
 *
 * The verifier needs this: fetching by root proves only that a gateway answered to that
 * root, and a hostile gateway could answer with anything. Recomputing the root over the
 * bytes actually received is what binds them to the record on chain.
 */
export async function merkleRootOf(bytes: string): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'og-verify-'));
  const path = join(dir, 'bundle.json');
  try {
    writeFileSync(path, bytes);
    const file = await ZgFile.fromFilePath(path);
    try {
      const [tree, err] = await file.merkleTree();
      const root = tree?.rootHash();
      if (err || !root) throw new UploadFailed(`merkle tree failed: ${err?.message}`);
      return root;
    } finally {
      await file.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * The indexer reports a missing file as HTTP 200 with an error envelope in the body:
 *
 *     {"code":101,"message":"File not found","data":null}
 *
 * Measured live 2026-08-23. `res.ok` is therefore not enough — without this check a
 * verifier would hand 51 bytes of JSON error to the recomputation and report that the
 * evidence had been tampered with, when the truth is that it was never there.
 */
export function assertNotGatewayError(body: string): void {
  if (!body.startsWith('{')) return;
  let parsed: any;
  try {
    parsed = JSON.parse(body);
  } catch {
    return;
  }
  if (typeof parsed?.code === 'number' && parsed.code !== 0 && typeof parsed?.message === 'string') {
    throw new UploadFailed(`the indexer has no file for this root: ${parsed.message}`);
  }
}

/**
 * Fetch the bundle back by root and hand over the bytes.
 *
 * Run before the chain write, not after: a root that cannot be fetched is not evidence,
 * and the ledger is write-once. Uses the same REST gateway an outside verifier would.
 */
export async function fetchBundle(indexerUrl: string, rootHash: string): Promise<string> {
  const res = await fetch(gatewayUrl(indexerUrl, rootHash));
  if (!res.ok) throw new UploadFailed(`gateway returned ${res.status} for root ${rootHash}`);
  const body = await res.text();
  assertNotGatewayError(body);
  return body;
}
