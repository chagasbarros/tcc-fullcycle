import type { FastifyInstance, FastifyReply } from 'fastify';
import { ZodError } from 'zod';

/**
 * Error with an HTTP meaning. Modules map their own errors to it in http/
 * (e.g. ProductNotFoundError -> 404), so the domain never knows about HTTP.
 */
export class HttpProblem extends Error {
  constructor(
    readonly status: number,
    readonly title: string,
    readonly detail?: string,
  ) {
    super(detail ?? title);
  }
}

interface ProblemBody {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance: string;
  errors?: { path: string; message: string }[];
}

function send(reply: FastifyReply, body: ProblemBody): FastifyReply {
  return reply.status(body.status).type('application/problem+json').send(body);
}

/** Every error response follows RFC 9457 (application/problem+json). */
export function registerProblemDetails(app: FastifyInstance): void {
  app.setErrorHandler((error, request, reply) => {
    const base = { type: 'about:blank', instance: request.url };

    if (error instanceof HttpProblem) {
      return send(reply, {
        ...base,
        status: error.status,
        title: error.title,
        ...(error.detail ? { detail: error.detail } : {}),
      });
    }

    if (error instanceof ZodError) {
      return send(reply, {
        ...base,
        status: 400,
        title: 'Bad Request',
        detail: 'The request has invalid fields.',
        errors: error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      });
    }

    // Errors raised by Fastify itself (malformed JSON, unsupported media type...).
    const status =
      typeof error === 'object' && error !== null && 'statusCode' in error
        ? Number(error.statusCode)
        : 500;
    if (status >= 400 && status < 500) {
      const detail = error instanceof Error ? error.message : undefined;
      return send(reply, { ...base, status, title: 'Bad Request', ...(detail ? { detail } : {}) });
    }

    // Unexpected: log the details, never leak them to the client.
    request.log.error({ err: error }, 'unhandled error');
    return send(reply, { ...base, status: 500, title: 'Internal Server Error' });
  });

  app.setNotFoundHandler((request, reply) =>
    send(reply, {
      type: 'about:blank',
      status: 404,
      title: 'Not Found',
      detail: `Route ${request.method} ${request.url} not found`,
      instance: request.url,
    }),
  );
}
