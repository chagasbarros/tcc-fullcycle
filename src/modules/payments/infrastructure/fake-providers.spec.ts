import { describe, expect, it } from 'vitest';
import { FakeCardProvider, FakePixProvider } from './fake-providers.js';

const charge = (amountInCents: number) => ({ idempotencyKey: 'o-1', amountInCents });

describe('fake payment providers (ADR-0011)', () => {
  it.each([0, 1_000, 1_012, 1_014, 1_130])('card approves %i cents', async (amount) => {
    expect(await new FakeCardProvider().charge(charge(amount))).toEqual({ approved: true });
  });

  it.each([13, 1_013, 99_913])('card declines %i cents (ends in 13)', async (amount) => {
    expect(await new FakeCardProvider().charge(charge(amount))).toMatchObject({
      approved: false,
    });
  });

  it('pix always approves', async () => {
    expect(await new FakePixProvider().charge()).toEqual({ approved: true });
  });

  it('simulates gateway latency when configured', async () => {
    const start = Date.now();
    await new FakePixProvider(50).charge();
    expect(Date.now() - start).toBeGreaterThanOrEqual(45);
  });
});
