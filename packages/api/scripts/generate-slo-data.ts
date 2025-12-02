import crypto from 'crypto';

const COLLECTOR_LOGS_URL =
  process.env.COLLECTOR_LOGS_URL || 'http://localhost:4318/v1/logs';
const COLLECTOR_TRACES_URL =
  process.env.COLLECTOR_TRACES_URL || 'http://localhost:4318/v1/traces';
const API_KEY = process.env.API_KEY || '';
const SERVICE_NAME = process.env.SERVICE_NAME || 'payment-service';
const ERROR_RATE = parseFloat(process.env.ERROR_RATE || '0.05'); // 5% default error rate
const INTERVAL_MS = parseInt(process.env.INTERVAL_MS || '500');
const TYPE = process.env.TYPE || 'logs'; // 'logs' or 'traces'

console.log(`Starting SLO Data Generator...`);
console.log(`Type: ${TYPE}`);
console.log(
  `Target: ${TYPE === 'logs' ? COLLECTOR_LOGS_URL : COLLECTOR_TRACES_URL}`,
);
console.log(`Service: ${SERVICE_NAME}`);
console.log(`Error Rate: ${ERROR_RATE * 100}%`);
console.log(`Interval: ${INTERVAL_MS}ms`);

function getTimestampNano() {
  const now = BigInt(Date.now()) * BigInt(1000000);
  return now.toString();
}

function generateLog() {
  const isError = Math.random() < ERROR_RATE;
  const traceId = crypto.randomBytes(16).toString('hex');
  const spanId = crypto.randomBytes(8).toString('hex');

  const logRecord = {
    timeUnixNano: getTimestampNano(),
    severityText: isError ? 'ERROR' : 'INFO',
    severityNumber: isError ? 17 : 9,
    body: {
      stringValue: isError
        ? 'Payment processing failed'
        : 'Payment processed successfully',
    },
    traceId: traceId,
    spanId: spanId,
    attributes: [
      {
        key: 'http.method',
        value: { stringValue: 'POST' },
      },
      {
        key: 'http.route',
        value: { stringValue: '/api/v1/process' },
      },
      {
        key: 'http.status_code',
        value: { intValue: isError ? 500 : 200 },
      },
      {
        key: 'user.id',
        value: { stringValue: `user-${Math.floor(Math.random() * 1000)}` },
      },
    ],
  };

  return {
    resourceLogs: [
      {
        resource: {
          attributes: [
            {
              key: 'service.name',
              value: { stringValue: SERVICE_NAME },
            },
            {
              key: 'environment',
              value: { stringValue: 'production' },
            },
          ],
        },
        scopeLogs: [
          {
            scope: {
              name: 'slo-generator',
              version: '1.0.0',
            },
            logRecords: [logRecord],
          },
        ],
      },
    ],
  };
}

function generateTrace() {
  const isError = Math.random() < ERROR_RATE;
  const traceId = crypto.randomBytes(16).toString('hex');
  const spanId = crypto.randomBytes(8).toString('hex');
  const startTimeUnixNano = getTimestampNano();
  const endTimeUnixNano = (
    BigInt(startTimeUnixNano) +
    BigInt(Math.floor(Math.random() * 500) * 1000000)
  ).toString();

  const span = {
    traceId: traceId,
    spanId: spanId,
    parentSpanId: '',
    name: 'POST /api/v1/process',
    kind: 2, // SPAN_KIND_SERVER
    startTimeUnixNano: startTimeUnixNano,
    endTimeUnixNano: endTimeUnixNano,
    attributes: [
      {
        key: 'http.method',
        value: { stringValue: 'POST' },
      },
      {
        key: 'http.route',
        value: { stringValue: '/api/v1/process' },
      },
      {
        key: 'http.status_code',
        value: { intValue: isError ? 500 : 200 },
      },
      {
        key: 'user.id',
        value: { stringValue: `user-${Math.floor(Math.random() * 1000)}` },
      },
    ],
    status: {
      code: isError ? 2 : 1, // 2 = Error, 1 = Ok
      message: isError ? 'Payment processing failed' : '',
    },
  };

  return {
    resourceSpans: [
      {
        resource: {
          attributes: [
            {
              key: 'service.name',
              value: { stringValue: SERVICE_NAME },
            },
            {
              key: 'environment',
              value: { stringValue: 'production' },
            },
          ],
        },
        scopeSpans: [
          {
            scope: {
              name: 'slo-generator',
              version: '1.0.0',
            },
            spans: [span],
          },
        ],
      },
    ],
  };
}

async function sendData(payload: any, type: 'logs' | 'traces') {
  const url = type === 'logs' ? COLLECTOR_LOGS_URL : COLLECTOR_TRACES_URL;
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (API_KEY) {
      headers['Authorization'] = `${API_KEY}`;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      console.error(
        `Failed to send ${type}: ${response.status} ${response.statusText}`,
      );
      const text = await response.text();
      console.error(text);
    }
  } catch (error) {
    console.error(`Error sending ${type}:`, error);
  }
}

let count = 0;
let errors = 0;

setInterval(async () => {
  let isError = false;

  if (TYPE === 'traces') {
    const payload = generateTrace();
    // Check status code of the span (2 = Error)
    isError = payload.resourceSpans[0].scopeSpans[0].spans[0].status.code === 2;
    await sendData(payload, 'traces');
  } else {
    const payload = generateLog();
    isError =
      payload.resourceLogs[0].scopeLogs[0].logRecords[0].severityText ===
      'ERROR';
    await sendData(payload, 'logs');
  }

  count++;
  if (isError) errors++;

  if (count % 10 === 0) {
    const currentRate = ((errors / count) * 100).toFixed(1);
    process.stdout.write(
      `\rSent ${count} ${TYPE}. Current error rate: ${currentRate}%  `,
    );
  }
}, INTERVAL_MS);
