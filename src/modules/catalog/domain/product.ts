export class InvalidProductError extends Error {
  override readonly name = 'InvalidProductError';
}

export class InsufficientStockError extends Error {
  override readonly name = 'InsufficientStockError';
}

export interface ProductProps {
  id: string;
  name: string;
  /** Money is always an integer amount of cents, never a float (CLAUDE.md, section 9). */
  priceInCents: number;
  stock: number;
}

/**
 * Product of the catalog. Plain TypeScript, no framework:
 * the rules can be tested without a database or HTTP server.
 */
export class Product {
  private constructor(private readonly props: ProductProps) {}

  static create(props: ProductProps): Product {
    const name = props.name.trim();
    if (name.length === 0) {
      throw new InvalidProductError('name must not be empty');
    }
    if (!Number.isInteger(props.priceInCents) || props.priceInCents < 0) {
      throw new InvalidProductError('priceInCents must be a non-negative integer');
    }
    if (!Number.isInteger(props.stock) || props.stock < 0) {
      throw new InvalidProductError('stock must be a non-negative integer');
    }
    return new Product({ ...props, name });
  }

  get id(): string {
    return this.props.id;
  }

  get name(): string {
    return this.props.name;
  }

  get priceInCents(): number {
    return this.props.priceInCents;
  }

  get stock(): number {
    return this.props.stock;
  }

  hasStockFor(quantity: number): boolean {
    return quantity > 0 && quantity <= this.props.stock;
  }

  decreaseStock(quantity: number): void {
    assertPositiveQuantity(quantity);
    if (!this.hasStockFor(quantity)) {
      throw new InsufficientStockError(
        `product ${this.props.id} has ${this.props.stock} in stock, requested ${quantity}`,
      );
    }
    this.props.stock -= quantity;
  }

  increaseStock(quantity: number): void {
    assertPositiveQuantity(quantity);
    this.props.stock += quantity;
  }
}

function assertPositiveQuantity(quantity: number): void {
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new InvalidProductError('quantity must be a positive integer');
  }
}
