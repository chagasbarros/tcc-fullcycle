import {
  LogController,
  type FastifyInstance,
  type FastifyServerOptions,
  type RawRequestDefaultExpression,
} from 'fastify';
import { newId } from '../ids.js';

export const REQUEST_ID_HEADER = 'x-request-id';

// Only short, plain ids are trusted: anything else could be used to forge log lines.
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{1,64}$/;

/** Reuses the caller's x-request-id when it is safe, otherwise generates a UUID v7. */
export function requestIdFrom(request: RawRequestDefaultExpression): string {
  const incoming = request.headers[REQUEST_ID_HEADER];
  return typeof incoming === 'string' && SAFE_REQUEST_ID.test(incoming) ? incoming : newId();
}

/** Fastify options: every log line of a request carries `requestId`. */
export const requestIdOptions = {
  genReqId: requestIdFrom,
  logController: new LogController({ requestIdLogLabel: 'requestId' }),
} satisfies FastifyServerOptions;

/** Echoes the id back, so a client can quote it when reporting a problem. */
export function registerRequestIdHeader(app: FastifyInstance): void {
  app.addHook('onSend', async (request, reply) => {
    void reply.header(REQUEST_ID_HEADER, request.id);
  });
}
