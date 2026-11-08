import type { FastifyPluginAsync } from 'fastify';

/**
 * Public API of the orders module — the only entry point other code may import
 * (enforced by eslint-plugin-boundaries). Routes from http/ are registered here.
 */
export const ordersModule: FastifyPluginAsync = () => Promise.resolve();
