import type { FastifyPluginAsync } from 'fastify';

/**
 * Public API of the catalog module — the only entry point other code may import
 * (enforced by eslint-plugin-boundaries). Routes from http/ are registered here.
 */
export const catalogModule: FastifyPluginAsync = () => Promise.resolve();
