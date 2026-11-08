import type { FastifyPluginAsync } from 'fastify';

/**
 * Public API of the payments module — the only entry point other code may import
 * (enforced by eslint-plugin-boundaries). Routes from http/ are registered here.
 */
export const paymentsModule: FastifyPluginAsync = () => Promise.resolve();
