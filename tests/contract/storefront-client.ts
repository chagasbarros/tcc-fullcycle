/**
 * Simulated consumer of the marketplace API: what a storefront (web/mobile) would call.
 * The consumer test runs it against the Pact mock server; what it expects becomes the contract.
 */
export interface ProductView {
  id: string;
  name: string;
  priceInCents: number;
  stock: number;
}

export interface OrderView {
  id: string;
  status: string;
  paymentMethod: 'CARD' | 'PIX';
  totalInCents: number;
  items: { productId: string; quantity: number; subtotalInCents: number }[];
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly title: string,
  ) {
    super(`${status} ${title}`);
  }
}

export class StorefrontClient {
  constructor(private readonly baseUrl: string) {}

  listProducts(page: number, pageSize: number) {
    return this.request<{ items: ProductView[]; total: number }>(
      'GET',
      `/catalog/products?page=${page}&pageSize=${pageSize}`,
    );
  }

  getProduct(id: string) {
    return this.request<ProductView>('GET', `/catalog/products/${id}`);
  }

  placeOrder(input: {
    customerId: string;
    paymentMethod: 'CARD' | 'PIX';
    items: { productId: string; quantity: number }[];
  }) {
    return this.request<OrderView>('POST', '/orders', input);
  }

  getOrder(id: string) {
    return this.request<OrderView>('GET', `/orders/${id}`);
  }

  cancelOrder(id: string) {
    return this.request<OrderView>('POST', `/orders/${id}/cancel`);
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: body ? { 'content-type': 'application/json' } : {},
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) {
      // Errors follow RFC 9457 (Problem Details).
      const problem = (await response.json()) as { status: number; title: string };
      throw new ApiError(problem.status, problem.title);
    }
    return (await response.json()) as T;
  }
}
