import { describe, it, expect } from 'vitest';
import {
  SimulatedFairnessServer,
  verifyRoll,
  sha256Hex,
  hmacSha256Hex,
  diceValueFromHmac,
} from './fairness';

describe('diceValueFromHmac', () => {
  it('maps the first byte below 252 to 1-6', () => {
    // 0x00 -> 1, 0x05 -> 6, 0x06 -> 1
    expect(diceValueFromHmac('00' + 'ab'.repeat(31))).toBe(1);
    expect(diceValueFromHmac('05' + 'ab'.repeat(31))).toBe(6);
    expect(diceValueFromHmac('06' + 'ab'.repeat(31))).toBe(1);
  });

  it('skips bytes >= 252 (rejection sampling, no modulo bias)', () => {
    // 0xff is rejected; 0x03 -> 4
    expect(diceValueFromHmac('ff03' + 'ab'.repeat(30))).toBe(4);
  });

  it('falls back to the last byte if every byte is rejected', () => {
    // all bytes >= 252; last byte 0xff -> 255 % 6 + 1 = 4
    expect(diceValueFromHmac('fcfdfeff')).toBe(4);
  });
});

describe('SimulatedFairnessServer', () => {
  it('publishes a commitment that matches the seed revealed by the roll', async () => {
    const server = new SimulatedFairnessServer();
    const commitment = await server.getCommitment();

    const record = await server.roll('my-client-seed');

    expect(record.nonce).toBe(commitment.nonce);
    expect(record.serverSeedHash).toBe(commitment.serverSeedHash);
    expect(await sha256Hex(record.serverSeed)).toBe(commitment.serverSeedHash);
  });

  it('keeps the commitment stable until the roll consumes it', async () => {
    const server = new SimulatedFairnessServer();
    const first = await server.getCommitment();
    const second = await server.getCommitment();
    expect(second).toEqual(first);
  });

  it('derives the value from HMAC-SHA256(serverSeed, clientSeed:nonce)', async () => {
    const server = new SimulatedFairnessServer();
    const record = await server.roll('seed-123');

    const expectedHmac = await hmacSha256Hex(record.serverSeed, `seed-123:${record.nonce}`);
    expect(record.hmac).toBe(expectedHmac);
    expect(record.value).toBe(diceValueFromHmac(expectedHmac));
    expect(record.value).toBeGreaterThanOrEqual(1);
    expect(record.value).toBeLessThanOrEqual(6);
  });

  it('uses a fresh seed and incremented nonce for each roll', async () => {
    const server = new SimulatedFairnessServer();
    const a = await server.roll('s');
    const b = await server.roll('s');
    expect(b.nonce).toBe(a.nonce + 1);
    expect(b.serverSeed).not.toBe(a.serverSeed);
    expect(b.serverSeedHash).not.toBe(a.serverSeedHash);
  });

  it('produces rolls that pass verification', async () => {
    const server = new SimulatedFairnessServer();
    for (let i = 0; i < 10; i++) {
      const record = await server.roll('verify-me');
      const result = await verifyRoll(record);
      expect(result).toEqual({ commitmentValid: true, valueValid: true, valid: true });
    }
  });
});

describe('verifyRoll tamper detection', () => {
  it('rejects a tampered value', async () => {
    const server = new SimulatedFairnessServer();
    const record = await server.roll('s');
    const tampered = { ...record, value: (record.value % 6) + 1 };
    expect((await verifyRoll(tampered)).valid).toBe(false);
  });

  it('rejects a swapped server seed (commitment mismatch)', async () => {
    const server = new SimulatedFairnessServer();
    const record = await server.roll('s');
    const tampered = { ...record, serverSeed: 'not-the-committed-seed' };
    const result = await verifyRoll(tampered);
    expect(result.commitmentValid).toBe(false);
    expect(result.valid).toBe(false);
  });
});
