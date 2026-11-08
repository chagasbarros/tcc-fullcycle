import type {
  ChargeRequest,
  ChargeResult,
  PaymentProvider,
} from '../application/payment-provider.js';
import { PaymentMethod } from '../domain/payment.js';

/** Simulated gateway latency (PAYMENT_PROVIDER_LATENCY_MS), useful for the k6 tests. */
function wait(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

/**
 * Card gateway simulator (ADR-0011). Deterministic so tests and demos are repeatable:
 * declines any amount ending in 13 cents (e.g. R$ 10,13) and approves the rest.
 */
export class FakeCardProvider implements PaymentProvider {
  readonly method = PaymentMethod.CARD;

  constructor(private readonly latencyMs = 0) {}

  async charge({ amountInCents }: ChargeRequest): Promise<ChargeResult> {
    await wait(this.latencyMs);
    if (amountInCents % 100 === 13) {
      return { approved: false, reason: 'card declined (amount ends in 13 cents)' };
    }
    return { approved: true };
  }
}

/** Pix simulator (ADR-0011): always approves. */
export class FakePixProvider implements PaymentProvider {
  readonly method = PaymentMethod.PIX;

  constructor(private readonly latencyMs = 0) {}

  async charge(): Promise<ChargeResult> {
    await wait(this.latencyMs);
    return { approved: true };
  }
}
