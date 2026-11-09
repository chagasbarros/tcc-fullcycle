/**
 * Fixed ids shared by the consumer test (which writes the pact) and the provider
 * verification (whose state handlers create this data before each interaction).
 */
export const CONSUMER = 'storefront';
export const PROVIDER = 'marketplace-api';
export const PACT_DIR = 'tests/contract/pacts';

export const PRODUCT_ID = '0199d000-0000-7000-8000-000000000001';
export const MISSING_PRODUCT_ID = '0199d000-0000-7000-8000-0000000000ff';
export const CUSTOMER_ID = '0199d000-0000-7000-8000-0000000000c1';
export const PENDING_ORDER_ID = '0199d000-0000-7000-8000-0000000000a1';
export const CANCELLED_ORDER_ID = '0199d000-0000-7000-8000-0000000000a2';

export const State = {
  PRODUCT_EXISTS: 'a product with stock exists',
  NO_PRODUCT: 'the product does not exist',
  PENDING_ORDER: 'a pending order exists',
  CANCELLED_ORDER: 'a cancelled order exists',
} as const;
