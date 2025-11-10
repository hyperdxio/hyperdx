import React, { useMemo } from 'react';
import Link from 'next/link';
import { pickBy } from 'lodash';
import CopyToClipboard from 'react-copy-to-clipboard';
import { JSONTree } from 'react-json-tree';
import {
  Accordion,
  Box,
  Button,
  CopyButton,
  TableData,
  Text,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';

import HyperJson from '@/components/HyperJson';
import { Table } from '@/components/Table';
import {
  headerColumns,
  networkColumns,
  SectionWrapper,
} from '@/LogSidePanelElements';
import { CollapsibleSection } from '@/LogSidePanelElements';
import { CurlGenerator } from '@/utils/curlGenerator';

interface NetworkPropertyPanelProps {
  eventAttributes: Record<string, any>;
  onPropertyAddClick?: (key: string, value: string) => void;
  generateSearchUrl: (query?: string, timeRange?: [Date, Date]) => string;
}

// https://github.com/reduxjs/redux-devtools/blob/f11383d294c1139081f119ef08aa1169bd2ad5ff/packages/react-json-tree/src/createStylingFromTheme.ts
const JSON_TREE_THEME = {
  base00: '#00000000',
  base01: '#383830',
  base02: '#49483e',
  base03: '#75715e',
  base04: '#a59f85',
  base05: '#f8f8f2',
  base06: '#f5f4f1',
  base07: '#f9f8f5',
  base08: '#f92672',
  base09: '#fd971f',
  base0A: '#f4bf75',
  base0B: '#a6e22e',
  base0C: '#a1efe4',
  base0D: '#8378FF', // Value Labels
  base0E: '#ae81ff',
  base0F: '#cc6633',
};

const parseHeaders = (
  keyPrefix: string,
  parsedProperties: any,
): [string, string][] => {
  const reqHeaderObj: Record<
    string,
    string | string[] | Record<string, string>
  > = pickBy(parsedProperties, (value, key) => key.startsWith(keyPrefix));

  return Object.entries(reqHeaderObj).flatMap(([fullKey, _value]) => {
    let value = _value;
    try {
      if (typeof _value === 'string') {
        value = JSON.parse(_value);
      }
    } catch (e) {
      // ignore
    }

    // Replacing _ -> - is part of the otel spec, idk why
    const key = fullKey.replace(keyPrefix, '').replace('_', '-');

    let keyVal = [[key, `${value}`]] as [string, string][];

    if (Array.isArray(value)) {
      keyVal = value.map(value => [key, `${value}`] as [string, string]);
    } else if (typeof value === 'object' && Object.keys(value).length > 0) {
      try {
        // TODO: We actually shouldn't be re-serializing this as it may mess with the original value
        keyVal = [[key, `${JSON.stringify(value)}`]] as [string, string][];
      } catch (e) {
        console.error(e);
      }
    }

    return keyVal;
  });
};

const generateCurl = ({
  method,
  headers,
  url,
  body,
}: {
  method?: string;
  headers: Array<{ name: string; value: string }>;
  url?: string;
  body?: string;
}) => {
  if (!url || !method) return '';

  let curl = `curl -X ${method} '${url}'`;
  headers.forEach(({ name, value }) => {
    curl += `\n  -H '${name}: ${value}'`;
  });

  if (body) {
    curl += `\n  -d '${body}'`;
  }

  return curl;
};

export const NetworkBody = ({
  body,
  theme,
  emptyMessage,
  notCollectedMessage,
}: {
  body: any;
  theme?: any;
  emptyMessage?: string;
  notCollectedMessage?: string;
}) => {
  const valueRenderer = React.useCallback((raw: any) => {
    return (
      <pre
        className="d-inline text-break"
        style={{
          whiteSpace: 'pre-wrap',
          wordWrap: 'break-word',
        }}
      >
        {raw}
      </pre>
    );
  }, []);

  const parsedBody = React.useMemo(() => {
    if (typeof body !== 'string') return null;
    try {
      if (
        (body.startsWith('{') && body.endsWith('}')) ||
        (body.startsWith('[') && body.endsWith(']'))
      ) {
        const parsed = JSON.parse(body);
        return parsed;
      }
    } catch (e) {
      return null;
    }
  }, [body]);

  return (
    <>
      {body != null && body != '' ? (
        <pre
          className="m-0 px-4 py-3"
          style={{
            wordBreak: 'break-all',
            wordWrap: 'break-word',
            whiteSpace: 'pre-wrap',
          }}
        >
          {parsedBody ? (
            <HyperJson data={parsedBody} normallyExpanded />
          ) : typeof body === 'string' ? (
            body
          ) : (
            <JSONTree
              hideRoot
              invertTheme={false}
              data={body}
              theme={theme}
              valueRenderer={valueRenderer}
            />
          )}
        </pre>
      ) : body === '' ? (
        <div className="text-slate-400 px-4 py-3">{emptyMessage}</div>
      ) : (
        <div className="text-slate-400 px-4 py-3">{notCollectedMessage}</div>
      )}
    </>
  );
};

export function NetworkPropertySubpanel({
  eventAttributes,
  onPropertyAddClick,
  generateSearchUrl,
}: NetworkPropertyPanelProps) {
  const requestHeaders = useMemo(
    () => parseHeaders('http.request.header.', eventAttributes),
    [eventAttributes],
  );

  const responseHeaders = useMemo(
    () => parseHeaders('http.response.header.', eventAttributes),
    [eventAttributes],
  );

  const url = eventAttributes['http.url'];
  const remoteAddress = eventAttributes['net.peer.ip'];
  const statusCode = eventAttributes['http.status_code'];
  const method = eventAttributes['http.method'];
  const requestBody = eventAttributes['http.request.body'];
  const responseBody = eventAttributes['http.response.body'];

  const curl = CurlGenerator({
    method,
    headers: requestHeaders,
    url,
    body: requestBody,
  });

  if (!url && !method && !statusCode) {
    return null;
  }

  return (
    <div>
      <div className="mb-3">
        <CopyToClipboard
          text={curl}
          onCopy={() => {
            notifications.show({
              color: 'green',
              message: 'Curl command copied to clipboard',
            });
          }}
        >
          <Button size="xs" variant="light">
            <i className="bi bi-terminal-plus me-2" />
            Copy Request as Curl
          </Button>
        </CopyToClipboard>
        {/* <Link href={trendsDashboardUrl} passHref legacyBehavior>
          <Button
            variant="dark"
            className="text-muted-hover fs-8"
            size="sm"
            as="a"
          >
            <i className="bi bi-graph-up me-2" />
            Endpoint Trends
          </Button>
        </Link> */}
      </div>

      <SectionWrapper>
        <Table
          borderless
          density="compact"
          columns={networkColumns}
          data={[
            url && { label: 'URL', value: url },
            method && { label: 'Method', value: method },
            remoteAddress && {
              label: 'Remote Address',
              value: remoteAddress,
            },
            statusCode && {
              label: 'Status',
              value: `${statusCode} ${
                eventAttributes['http.status_text'] ?? ''
              }`,
              className:
                statusCode >= 500
                  ? 'text-danger'
                  : statusCode >= 400
                    ? 'text-warning'
                    : 'text-success',
            },
          ].filter(Boolean)}
          hideHeader
        />
      </SectionWrapper>

      {requestHeaders.length > 0 && (
        <CollapsibleSection
          title={`Request Headers (${requestHeaders.length})`}
          initiallyCollapsed
        >
          <SectionWrapper>
            <Table
              borderless
              hideHeader
              density="compact"
              columns={headerColumns}
              data={requestHeaders}
              emptyMessage="No request headers collected"
            />
          </SectionWrapper>
        </CollapsibleSection>
      )}

      {requestBody != null && (
        <CollapsibleSection title="Request Body">
          <SectionWrapper>
            <NetworkBody
              body={requestBody}
              theme={JSON_TREE_THEME}
              emptyMessage="Empty request"
              notCollectedMessage="No request body collected"
            />
          </SectionWrapper>
        </CollapsibleSection>
      )}
      {responseHeaders.length > 0 && (
        <CollapsibleSection
          title={`Response Headers (${responseHeaders.length})`}
          initiallyCollapsed
        >
          <SectionWrapper>
            <Table
              borderless
              hideHeader
              density="compact"
              columns={headerColumns}
              data={responseHeaders}
              emptyMessage="No response headers collected"
            />
          </SectionWrapper>
        </CollapsibleSection>
      )}
      {responseBody != null && (
        <CollapsibleSection title="Response Body">
          <SectionWrapper>
            <NetworkBody
              body={responseBody}
              theme={JSON_TREE_THEME}
              emptyMessage="Empty response"
              notCollectedMessage="No response body collected"
            />
          </SectionWrapper>
        </CollapsibleSection>
      )}
    </div>
  );
}
