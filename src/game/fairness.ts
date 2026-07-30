/**
 * Provably-fair dice via commit-reveal.
 *
 * Protocol (per roll):
 *  1. The "server" generates a random serverSeed and publishes SHA-256(serverSeed)
 *     BEFORE the roll (the commitment).
 *  2. The roll value is derived as HMAC-SHA256(key=serverSeed, msg=`${clientSeed}:${nonce}`),
 *     mapped to 1-6 with rejection sampling (no modulo bias).
 *  3. After the roll, serverSeed is revealed so anyone can check both the
 *     commitment hash and the derived value.
 *
 * The server side is simulated in-browser here (SimulatedFairnessServer); the
 * FairnessProvider interface is the seam where a real backend slots in later.
 */

export interface RollCommitment {
  /** Roll counter — part of the HMAC message so every roll is unique. */
  nonce: number;
  /** SHA-256 of the (still secret) server seed, published before the roll. */
  serverSeedHash: string;
}

export interface FairRollRecord {
  nonce: number;
  clientSeed: string;
  /** Revealed after the roll. */
  serverSeed: string;
  /** The pre-roll commitment: SHA-256(serverSeed). */
  serverSeedHash: string;
  /** HMAC-SHA256(serverSeed, `${clientSeed}:${nonce}`) as hex. */
  hmac: string;
  /** The dice value 1-6 derived from the HMAC. */
  value: number;
}

export interface FairnessProvider {
  /** Commitment for the upcoming roll. Stable until roll() consumes it. */
  getCommitment(): Promise<RollCommitment>;
  /** Executes the committed roll and reveals the server seed. */
  roll(clientSeed: string): Promise<FairRollRecord>;
}

const encoder = new TextEncoder();

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

export async function sha256Hex(message: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(message));
  return bytesToHex(new Uint8Array(digest));
}

export async function hmacSha256Hex(key: string, message: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(message));
  return bytesToHex(new Uint8Array(sig));
}

/**
 * Maps an HMAC (hex) to a dice value 1-6 without modulo bias: scan bytes and
 * take the first one below 252 (the largest multiple of 6 ≤ 256). The chance
 * that all 32 bytes are ≥ 252 is (4/256)^32 ≈ 10^-58; the last byte is the
 * deterministic fallback so verification always agrees.
 */
export function diceValueFromHmac(hmacHex: string): number {
  const bytes: number[] = [];
  for (let i = 0; i < hmacHex.length; i += 2) bytes.push(parseInt(hmacHex.slice(i, i + 2), 16));
  for (const b of bytes) {
    if (b < 252) return (b % 6) + 1;
  }
  return (bytes[bytes.length - 1] % 6) + 1;
}

/** Recomputes the whole chain from a revealed record; every check must pass. */
export async function verifyRoll(record: FairRollRecord): Promise<{
  commitmentValid: boolean;
  valueValid: boolean;
  valid: boolean;
}> {
  const commitmentValid = (await sha256Hex(record.serverSeed)) === record.serverSeedHash;
  const hmac = await hmacSha256Hex(record.serverSeed, `${record.clientSeed}:${record.nonce}`);
  const valueValid = hmac === record.hmac && diceValueFromHmac(hmac) === record.value;
  return { commitmentValid, valueValid, valid: commitmentValid && valueValid };
}

export function randomSeedHex(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

/** In-browser stand-in for the real fairness backend. */
export class SimulatedFairnessServer implements FairnessProvider {
  private nonce = 0;
  private serverSeed: string | null = null;
  private serverSeedHash: string | null = null;

  async getCommitment(): Promise<RollCommitment> {
    if (this.serverSeed === null || this.serverSeedHash === null) {
      this.serverSeed = randomSeedHex();
      this.serverSeedHash = await sha256Hex(this.serverSeed);
    }
    return { nonce: this.nonce, serverSeedHash: this.serverSeedHash };
  }

  async roll(clientSeed: string): Promise<FairRollRecord> {
    const { nonce, serverSeedHash } = await this.getCommitment();
    const serverSeed = this.serverSeed!;
    const hmac = await hmacSha256Hex(serverSeed, `${clientSeed}:${nonce}`);
    const value = diceValueFromHmac(hmac);
    // Seed is revealed — discard it so the next roll gets a fresh commitment.
    this.serverSeed = null;
    this.serverSeedHash = null;
    this.nonce++;
    return { nonce, clientSeed, serverSeed, serverSeedHash, hmac, value };
  }
}
