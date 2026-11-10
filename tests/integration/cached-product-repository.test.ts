import { v7 } from 'uuid';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  inject,
  it,
  vi,
  type Mock,
  type MockInstance,
} from 'vitest';
import { Product } from '../../src/modules/catalog/domain/product.js';
import {
  CachedProductRepository,
  InMemoryProductRepository,
  type ProductRepository,
} from '../../src/modules/catalog/index.js';
import { createCacheRedisConnection } from '../../src/shared/cache/redis-cache.js';

/**
 * Cache-aside against a real Redis. The repository behind the cache is in-memory and
 * wrapped in spies, so each test can tell whether a read reached the "database".
 */
describe('CachedProductRepository (Redis)', () => {
  const redis = createCacheRedisConnection(inject('redisUrl'));
  let database: InMemoryProductRepository;
  let inner: ProductRepository;
  let cacheEnabled: boolean;
  let onError: Mock<(error: unknown) => void>;
  let cached: CachedProductRepository;
  let databaseFindById: MockInstance;
  let databaseList: MockInstance;

  const keyboard = (stock = 10) =>
    Product.create({ id: v7(), name: 'Keyboard', priceInCents: 34_990, stock });

  // Fail-fast connection: commands sent before it is ready fail (and would fall back to
  // the database). Wait for it, so the tests exercise the cache itself.
  beforeAll(async () => {
    if (redis.status !== 'ready') await new Promise((resolve) => redis.once('ready', resolve));
  });

  beforeEach(async () => {
    await redis.flushdb();
    database = new InMemoryProductRepository();
    inner = database;
    databaseFindById = vi.spyOn(database, 'findById');
    databaseList = vi.spyOn(database, 'list');
    cacheEnabled = true;
    onError = vi.fn<(error: unknown) => void>();
    cached = new CachedProductRepository(inner, redis, {
      isEnabled: () => cacheEnabled,
      onError,
    });
  });

  afterAll(() => redis.quit());

  it('findById: the second read is served by Redis, not the database', async () => {
    const product = keyboard();
    await database.save(product);

    const first = await cached.findById(product.id);
    const second = await cached.findById(product.id);

    expect(second).toEqual(first);
    expect(second?.priceInCents).toBe(34_990);
    expect(databaseFindById).toHaveBeenCalledTimes(1);
  });

  it('list: pages are cached separately and expire within the 60 s TTL', async () => {
    await database.save(keyboard());
    await database.save(keyboard());

    await cached.list({ offset: 0, limit: 1 });
    await cached.list({ offset: 0, limit: 1 });
    await cached.list({ offset: 1, limit: 1 });

    expect(databaseList).toHaveBeenCalledTimes(2); // one miss per page
    const ttl = await redis.ttl('catalog:products:list');
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(60);
  });

  it('save invalidates the product and every list page', async () => {
    const product = keyboard();
    await cached.save(product);
    await cached.findById(product.id);
    await cached.list({ offset: 0, limit: 20 });

    await cached.save(Product.create({ id: v7(), name: 'Mouse', priceInCents: 9_990, stock: 3 }));
    const page = await cached.list({ offset: 0, limit: 20 });

    expect(page.total).toBe(2); // the new product shows up at once
    expect(databaseList).toHaveBeenCalledTimes(2);
  });

  it('stock changes are tolerated stale (ADR-0014): the listing keeps the cached stock', async () => {
    const product = keyboard(10);
    await database.save(product);
    await cached.list({ offset: 0, limit: 20 });

    expect(await cached.reserveStock([{ productId: product.id, quantity: 3 }])).toBe(true);
    const page = await cached.list({ offset: 0, limit: 20 });

    expect(page.items[0]?.stock).toBe(10); // still the cached value, up to 60 s
    expect((await database.findById(product.id))?.stock).toBe(7); // the truth is in the database
  });

  it('with the flag off, every read goes to the database and nothing is cached', async () => {
    const product = keyboard();
    await database.save(product);
    cacheEnabled = false;

    await cached.findById(product.id);
    await cached.findById(product.id);

    expect(databaseFindById).toHaveBeenCalledTimes(2);
    expect(await redis.exists(`catalog:product:${product.id}`)).toBe(0);
  });

  it('if Redis is down, reads fall back to the database and the error is reported', async () => {
    // Nothing listens on this port; the fail-fast connection must not hang the read.
    const down = createCacheRedisConnection('redis://127.0.0.1:1');
    down.on('error', () => {}); // connection errors are expected here
    const product = keyboard();
    await database.save(product);
    const withoutRedis = new CachedProductRepository(inner, down, {
      isEnabled: () => true,
      onError,
    });

    const startedAt = Date.now();
    const found = await withoutRedis.findById(product.id);

    expect(found?.id).toBe(product.id);
    expect(onError).toHaveBeenCalled();
    expect(Date.now() - startedAt).toBeLessThan(1_000);
    down.disconnect();
  });
});
