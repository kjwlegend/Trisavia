import type { FastifyInstance, FastifyRequest } from "fastify";
import type { M1Action, M1Service } from "../../application/m1-service.ts";
import { M1Error, fail } from "../../domains/common/errors.ts";
import { StorageError } from "../../contracts/store.ts";
import { FOUNDATION_HTTP_OPERATIONS } from "../../contracts/foundation-operations.ts";

type Definition = { method: "GET" | "POST" | "PUT"; url: string; action: M1Action };
const routes: Definition[] = [
  ...FOUNDATION_HTTP_OPERATIONS.map(({ method, path, action }) => ({ method, url: path, action })),
  { method: "POST", url: "/v1/registrations", action: "register" },
  { method: "GET", url: "/v1/registration-attempts/:attemptId", action: "registrationResult" },
  { method: "POST", url: "/v1/agent/self/handoffs", action: "issueHandoff" },
  { method: "POST", url: "/v1/agent/self/delivery-declarations", action: "declareDelivery" },
  { method: "GET", url: "/v1/owner-handoffs/:handoffId", action: "previewHandoff" },
  { method: "POST", url: "/v1/owner-setups", action: "exchangeSetup" },
  { method: "GET", url: "/v1/owner/setup", action: "readSetup" },
  { method: "POST", url: "/v1/owner/setup/complete", action: "completeSetup" },
  { method: "POST", url: "/v1/owner/accounts", action: "registerOwner" },
  { method: "GET", url: "/v1/owner/account", action: "readAccount" },
  { method: "POST", url: "/v1/owner/agent-claims", action: "claimAgent" },
  { method: "POST", url: "/v1/owner/sessions", action: "login" },
  { method: "GET", url: "/v1/owner/recovery", action: "readRecovery" },
  { method: "POST", url: "/v1/owner/recoveries", action: "recover" },
  { method: "GET", url: "/v1/owner/agents", action: "listAgents" },
  { method: "GET", url: "/v1/owner/agents/:agentId", action: "managedAgent" },
  { method: "GET", url: "/v1/owner/agent-invites", action: "listInvites" },
  { method: "POST", url: "/v1/owner/agent-invites", action: "issueInvite" },
  { method: "POST", url: "/v1/owner/agent-invites/:inviteId/revoke", action: "revokeInvite" },
  { method: "POST", url: "/v1/owner/agents/:agentId/runtime-access/revoke", action: "revokeRuntime" },
  { method: "POST", url: "/v1/owner/agents/:agentId/runtime-access/replace", action: "replaceRuntime" },
  { method: "GET", url: "/v1/operations/:operationId", action: "receipt" },
];

function headerToken(request: FastifyRequest): string | undefined {
  const authorization = request.headers.authorization;
  if (authorization === undefined) return undefined;
  if (!/^Bearer [^\s]+$/u.test(authorization)) fail("authentication_failed", 401, "Authentication failed");
  return authorization.slice(7);
}

export function registerM1Routes(app: FastifyInstance, service: M1Service): void {
  // This also covers parser errors, before any handler has had a chance to run.
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof M1Error) {
      return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) } });
    }
    if (error instanceof StorageError) {
      return reply.code(error.code === "constraint" || error.code === "conflict" ? 409 : 503).send({ error: {
        code: error.code === "constraint" || error.code === "conflict" ? "state_conflict" : "retry_same_operation",
        message: error.code === "constraint" || error.code === "conflict" ? "State changed; read the current result" : "Service unavailable; retry the same operation",
      } });
    }
    if (typeof error === "object" && error !== null && "statusCode" in error && typeof error.statusCode === "number" && error.statusCode < 500) {
      return reply.code(error.statusCode === 413 ? 413 : 400).send({ error: { code: "invalid_request", message: "Request is invalid" } });
    }
    return reply.code(503).send({ error: { code: "commit_result_unknown", message: "Result is unknown; query or retry the same operation" } });
  });

  const windows = new Map<string, { start: number; count: number }>();
  let lastCleanup = Date.now();
  for (const definition of routes) {
    app.route({
      method: definition.method, url: definition.url, bodyLimit: 16 * 1024,
      handler(request, reply) {
        reply.header("Cache-Control", "no-store");
        const stamp = Date.now();
        if (stamp - lastCleanup >= 60_000) {
          for (const [key, window] of windows) if (stamp - window.start >= 60_000) windows.delete(key);
          lastCleanup = stamp;
        }
        const window = windows.get(request.ip);
        if ((!window && windows.size >= 10_000) || (window && window.count >= 240 && stamp - window.start < 60_000)) fail("quota_exceeded", 429, "Request limit reached; retry later");
        if (!window || stamp - window.start >= 60_000) windows.set(request.ip, { start: stamp, count: 1 });
        else window.count++;
        const query = request.query as Record<string, unknown>;
        if (definition.action !== "receipt" && Object.keys(query).length > 0) fail("invalid_request", 400, "Query parameters are not supported");
        const params = request.params as Record<string, string>;
        const body = request.body === undefined ? {} : request.body;
        if (body === null || typeof body !== "object" || Array.isArray(body)) fail("invalid_request", 400, "Expected a JSON object");
        if (Object.keys(params).some((key) => key in body)) fail("invalid_request", 400, "Resource identifiers belong in the path");
        if (definition.action === "receipt") {
          // GET payloads are not parsed by Fastify, so inspect framing as well.
          const hasBody = request.body !== undefined || request.headers["transfer-encoding"] !== undefined
            || (request.headers["content-length"] !== undefined && request.headers["content-length"] !== "0");
          if (hasBody || Object.keys(params).some((key) => key in query)) fail("invalid_request", 400, "Receipt selectors belong in the query; operation ID belongs in the path");
          return service.invoke("receipt", { ...query, ...params }, headerToken(request));
        }
        return service.invoke(definition.action, { ...body, ...params }, headerToken(request));
      },
    });
  }
}
