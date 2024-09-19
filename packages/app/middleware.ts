import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

const healthCheckUrl = process.env.HEALTHCHECK_PATH || '/health';

export function middleware(request: NextRequest) {
  if (healthCheckUrl === request.nextUrl.pathname) {
    return NextResponse.json({ data: 'ok' }, { status: 200 });
  }

  return NextResponse.next();
}
