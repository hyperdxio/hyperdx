import type { Rng } from './rng';
import { type Call, pods, ROUTES } from './topology';
import {
  type Failure,
  PROMO_CODES,
  type RequestAttrs,
  TENANTS,
  type World,
} from './world';

export type PlannedLog = {
  atMs: number;
  severity: 'INFO' | 'WARN' | 'ERROR';
  body: string;
  attrs: Record<string, string>;
};
export type PlannedSpan = {
  service: string;
  pod: string;
  name: string;
  kind: 'SERVER' | 'CLIENT' | 'PRODUCER' | 'CONSUMER';
  startMs: number;
  endMs: number;
  attrs: Record<string, string | number | boolean>;
  error?: { message: string };
  children: PlannedSpan[];
  logs: PlannedLog[];
};
export type PlannedTrace = { root: PlannedSpan; route: string; status: number };

export function requestAttrs(r: Rng): RequestAttrs {
  const [tenantId, tenantTier] = r.pick(TENANTS);
  return {
    tenantId,
    tenantTier,
    // Explicit type args: the array literals infer as `string`, which doesn't match the union fields.
    platform: r.weighted<RequestAttrs['platform']>([
      ['web', 50],
      ['ios', 30],
      ['android', 20],
    ]),
    region: r.weighted<RequestAttrs['region']>([
      ['us-east-1', 50],
      ['us-west-2', 30],
      ['eu-west-1', 20],
    ]),
    promoCode: r.next() < 0.4 ? r.pick(PROMO_CODES) : undefined,
    cacheHit: r.next() < 0.7,
  };
}

type Ctx = {
  t: Date;
  route: string;
  attrs: RequestAttrs;
  world: World;
  r: Rng;
};

// Returns the server-side span for `call` starting at startMs, with the status it produced.
function serve(
  call: Call,
  startMs: number,
  ctx: Ctx,
): { span: PlannedSpan; status: number } {
  const b = ctx.world[call.service];
  const pod = ctx.r.pick(pods(call.service));
  const lat = b.podLatencyMs?.[pod] ?? b.latencyMs;
  const isConsumer = call.op.endsWith('.consume');
  const span: PlannedSpan = {
    service: call.service,
    pod,
    name: call.op,
    kind: isConsumer ? 'CONSUMER' : 'SERVER',
    startMs,
    endMs: startMs,
    attrs: baseAttrs(ctx, b.versions[pod], pod),
    children: [],
    logs: [],
  };
  const status = 200;
  let cursor = startMs + ctx.r.gauss(lat.mean / 3, 1);

  // The incident hook decides before the callees run, since a fail-fast handler never calls them.
  const hop = {
    t: ctx.t,
    service: call.service,
    pod,
    route: ctx.route,
    attrs: ctx.attrs,
    rng: ctx.r,
  };
  const failure = b.failIf?.(hop) ?? null;
  if (failure)
    return finish(
      span,
      cursor + (failure.durationMs ?? ctx.r.gauss(8, 3)),
      failure,
      ctx,
    );

  for (const child of call.calls ?? []) {
    if (child.store) {
      const sl = b.storeLatencyByName?.[child.store.name] ?? b.storeLatencyMs;
      const dur = ctx.r.gauss(sl.mean, sl.sd);
      span.children.push({
        service: call.service,
        pod,
        name: child.op,
        kind: 'CLIENT',
        startMs: cursor,
        endMs: cursor + dur,
        attrs: {
          'db.system': child.store.system,
          'server.address': child.store.name,
          ...baseAttrs(ctx, b.versions[pod], pod),
        },
        children: [],
        logs: [],
      });
      cursor += dur;
      continue;
    }
    const isPublish = child.calls?.[0]?.op.endsWith('.consume') ?? false;
    const clientAt = (at: number): PlannedSpan => ({
      service: call.service,
      pod,
      name: child.op,
      kind: isPublish ? 'PRODUCER' : 'CLIENT',
      startMs: at,
      endMs: at,
      attrs: {
        'peer.service': child.service,
        ...baseAttrs(ctx, b.versions[pod], pod),
      },
      children: [],
      logs: [],
    });
    if (isPublish) {
      // The consumer runs after the publish returns; it is asynchronous and never fails the request.
      const client = clientAt(cursor);
      client.endMs = cursor + ctx.r.gauss(4, 1);
      const consumed = serve(
        child.calls![0],
        client.endMs + ctx.r.gauss(150, 50),
        ctx,
      );
      client.children.push(consumed.span);
      span.children.push(client);
      cursor = client.endMs;
      continue;
    }
    const attempts = 1 + (b.retries?.[child.service] ?? 0);
    let calleeStatus = 200,
      client!: PlannedSpan,
      served!: PlannedSpan;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      client = clientAt(cursor);
      if (attempt > 1) {
        client.attrs['http.request.resend_count'] = attempt - 1;
        client.logs.push({
          atMs: cursor,
          severity: 'WARN',
          body: `retrying ${child.op} after ${calleeStatus} from ${child.service} (attempt ${attempt}/${attempts})`,
          attrs: { 'http.route': ctx.route },
        });
      }
      const callee = serve(child, cursor + 1, ctx);
      served = callee.span;
      const calleeDur = callee.span.endMs - callee.span.startMs;
      if (calleeDur > b.timeoutMs) {
        client.endMs = cursor + b.timeoutMs;
        client.error = {
          message: `timeout after ${b.timeoutMs}ms calling ${child.service}`,
        };
        callee.status = 504;
      } else {
        client.endMs = callee.span.endMs + 1;
        if (callee.status >= 500)
          client.error = {
            message: `${child.service} returned ${callee.status}`,
          };
      }
      calleeStatus = callee.status;
      client.attrs['http.response.status_code'] = calleeStatus;
      client.children.push(callee.span);
      span.children.push(client);
      cursor = client.endMs;
      if (calleeStatus < 500) break;
    }
    if (calleeStatus >= 500 && !child.optional) {
      return finish(
        span,
        cursor + ctx.r.gauss(3, 1),
        {
          status: calleeStatus === 504 ? 504 : 502,
          message: client.error!.message,
        },
        ctx,
      );
    }
    const late =
      calleeStatus < 500
        ? b.afterCall?.(hop, {
            service: child.service,
            op: child.op,
            pod: served.pod,
            version: String(served.attrs['service.version']),
          })
        : null;
    if (late)
      return finish(
        span,
        cursor + (late.durationMs ?? ctx.r.gauss(3, 1)),
        late,
        ctx,
      );
  }
  if (ctx.r.next() < b.errorRate)
    return finish(
      span,
      cursor + ctx.r.gauss(5, 2),
      { status: 500, message: 'internal error' },
      ctx,
    );
  return finish(
    span,
    cursor + ctx.r.gauss(lat.mean / 2, lat.sd) + (b.delayMs?.(hop) ?? 0),
    null,
    ctx,
  );
}

function finish(
  span: PlannedSpan,
  endMs: number,
  failure: Failure | null,
  ctx: Ctx,
): { span: PlannedSpan; status: number } {
  span.endMs = Math.max(endMs, span.startMs + 1);
  const status = failure?.status ?? 200;
  span.attrs['http.response.status_code'] = status;
  if (failure) {
    span.error = { message: failure.message };
    if (
      failure.log &&
      (!failure.log.every || ctx.r.next() < 1 / failure.log.every)
    ) {
      span.logs.push({
        atMs: span.endMs,
        severity: failure.log.severity,
        body: failure.log.body,
        attrs: { 'http.route': ctx.route },
      });
    }
  }
  return { span, status };
}

function baseAttrs(
  ctx: Ctx,
  version: string,
  pod: string,
): Record<string, string | number | boolean> {
  const [method, path] = ctx.route.split(' ');
  return {
    'http.request.method': method,
    'http.route': path,
    'k8s.pod.name': pod,
    'service.version': version,
    'cloud.region': ctx.attrs.region,
    'tenant.id': ctx.attrs.tenantId,
    'tenant.tier': ctx.attrs.tenantTier,
    'client.platform': ctx.attrs.platform,
    ...(ctx.attrs.promoCode && path === '/checkout'
      ? { 'checkout.promo_code': ctx.attrs.promoCode }
      : {}),
    'cache.hit': ctx.attrs.cacheHit,
  };
}

// Pins the route, bff and tenant of one request, for traffic an incident adds on top of the steady mix.
export type Forced = {
  route: string;
  bff: 'web-bff' | 'mobile-bff';
  tenantId: string;
};

export function walk(
  t: Date,
  world: World,
  r: Rng,
  forced?: Forced,
): PlannedTrace {
  const route = forced
    ? ROUTES.find(rt => `${rt.method} ${rt.path}` === forced.route)
    : r.weighted(ROUTES.map(rt => [rt, rt.weight] as [typeof rt, number]));
  if (!route) throw new Error(`unknown route ${forced?.route}`);
  const bff =
    forced?.bff ??
    r.weighted([
      ['web-bff', 60],
      ['mobile-bff', 40],
    ]);
  const attrs = requestAttrs(r);
  if (forced) {
    const tenant = TENANTS.find(([id]) => id === forced.tenantId);
    if (!tenant) throw new Error(`unknown tenant ${forced.tenantId}`);
    [attrs.tenantId, attrs.tenantTier] = tenant;
  }
  const ctx: Ctx = {
    t,
    route: `${route.method} ${route.path}`,
    attrs,
    world,
    r,
  };
  const { span, status } = serve(route.tree(bff), t.getTime(), ctx);
  return { root: span, route: ctx.route, status };
}
