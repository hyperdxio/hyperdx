/**
 * Sessions keyed on `session.id`, as the OpenTelemetry browser SDK sends them.
 * The rest of the session seed uses the legacy SDK's `rum.sessionId`.
 */

export const OTEL_SESSIONS = {
  /** `session.id` only: replay rows and one failed fetch span. */
  newSdk: 'e2e-new-sdk-session',
  /** Both keys with the same value, as after the collector copies one to the other. */
  bothKeys: 'e2e-both-keys-session',
} as const;

const SERVICE = 'browser';
const PAGE_URL = 'http://localhost:8080/';

function replayRows(
  startMs: number,
  resourceAttributes: string,
  sessionId: string,
): string[] {
  const events = [
    { type: 4, data: { href: PAGE_URL, width: 1280, height: 720 } },
    {
      type: 2,
      data: {
        node: { type: 0, childNodes: [], id: 1 },
        initialOffset: { left: 0, top: 0 },
      },
    },
  ];
  return events.map((event, i) => {
    const timestampMs = startMs + i * 1000;
    const body = JSON.stringify({ ...event, timestamp: timestampMs });
    return `('${timestampMs * 1_000_000}', '', '', 0, '', 0, '${SERVICE}', '${body}', '', ${resourceAttributes}, '', 'rum.rr-web', '', {}, {'session.id':'${sessionId}','rr-web.event':'${i + 1}','rr-web.offset':'${i + 1}','rr-web.chunk':'1','rr-web.total-chunks':'1'})`;
  });
}

export function generateOtelSessionReplayRows(seedRef: number): string {
  const startMs = seedRef - 5 * 60 * 1000;
  return [
    ...replayRows(
      startMs,
      `{'service.name':'${SERVICE}'}`,
      OTEL_SESSIONS.newSdk,
    ),
    ...replayRows(
      startMs,
      `{'rum.sessionId':'${OTEL_SESSIONS.bothKeys}','service.name':'${SERVICE}'}`,
      OTEL_SESSIONS.bothKeys,
    ),
  ].join(',\n');
}

export function generateOtelSessionSpans(seedRef: number): string {
  const ns = (seedRef - 5 * 60 * 1000 + 500) * 1_000_000;
  const { newSdk, bothKeys } = OTEL_SESSIONS;
  return [
    `('${ns}', '${newSdk}-trace', '${newSdk}-span', '', '', 'GET', 'SPAN_KIND_CLIENT', '${SERVICE}', {'service.name':'${SERVICE}'}, '@opentelemetry/instrumentation-fetch', '', {'session.id':'${newSdk}','browser.document.url.full':'${PAGE_URL}','url.full':'${PAGE_URL}api/error','http.request.method':'GET','http.response.status_code':'500','error.type':'500'}, 12000000, 'Error', '', [], [], [], [], [], [], [])`,
    // url.full, which document-load sets, lists the span on the All tab.
    `('${ns}', '${bothKeys}-trace', '${bothKeys}-span', '', '', 'documentFetch', 'SPAN_KIND_INTERNAL', '${SERVICE}', {'rum.sessionId':'${bothKeys}','service.name':'${SERVICE}'}, '', '', {'session.id':'${bothKeys}','component':'document-load','url.full':'${PAGE_URL}'}, 3000000, 'Unset', '', [], [], [], [], [], [], [])`,
  ].join(',\n');
}

// Four dots inside the 12 ms span.
const RESOURCE_TIMING = {
  fetch_start: '1000.5',
  request_start: '1002',
  response_start: '1009',
  response_end: '1011.5',
  duration: '11',
  transfer_size: '558',
  next_hop_protocol: 'http/1.1',
};

/**
 * OTel SDK log events around the +500 ms span: the click 3 ms before it that
 * triggers its trace, its request timing, and a console error.
 */
export function generateOtelSessionLogEvents(seedRef: number): string {
  const ns = (offsetMs: number) =>
    (seedRef - 5 * 60 * 1000 + offsetMs) * 1_000_000;
  const resource = `{'service.name':'${SERVICE}'}`;
  const { newSdk, bothKeys } = OTEL_SESSIONS;
  const click = (sessionId: string) =>
    `('${ns(497)}', '', '', 0, '', 9, '${SERVICE}', '', '', ${resource}, '', '', '', {}, {'session.id':'${sessionId}','browser.tag_name':'BUTTON','browser.css_selector':'#root > main > button.checkout','browser.document.url.full':'${PAGE_URL}','browser.element.attributes.testid':'checkout'}, 'browser.user_action.click')`;
  const timing = Object.entries(RESOURCE_TIMING)
    .map(([key, value]) => `'browser.resource_timing.${key}':'${value}'`)
    .join(',');
  return [
    click(newSdk),
    `('${ns(520)}', '${newSdk}-trace', '${newSdk}-span', 0, '', 9, '${SERVICE}', '', '', ${resource}, '', '@opentelemetry/browser-instrumentation/resource-timing', '', {}, {'session.id':'${newSdk}','browser.document.url.full':'${PAGE_URL}','url.full':'${PAGE_URL}api/error',${timing}}, 'browser.resource_timing')`,
    `('${ns(800)}', '', '', 0, 'error', 17, '${SERVICE}', 'Error: checkout failed', '', ${resource}, '', '', '', {}, {'session.id':'${newSdk}','browser.console.method':'error','browser.document.url.full':'${PAGE_URL}'}, 'browser.console')`,
    click(bothKeys),
  ].join(',\n');
}
