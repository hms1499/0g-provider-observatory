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
 * Fetch the bundle back by root and hand over the bytes.
 *
 * Run before the chain write, not after: a root that cannot be fetched is not evidence,
 * and the ledger is write-once. Uses the same REST gateway an outside verifier would.
 */
export async function fetchBundle(indexerUrl: string, rootHash: string): Promise<string> {
  const res = await fetch(gatewayUrl(indexerUrl, rootHash));
  if (!res.ok) throw new UploadFailed(`gateway returned ${res.status} for root ${rootHash}`);
  return res.text();
}
