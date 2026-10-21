import upperFirst from 'lodash/upperFirst';
import type { ReactNode } from 'react';

import { Table } from '@/components/Table';
import {
  CollapsibleSection,
  headerColumns,
  NetworkBody,
  SectionWrapper,
} from '@/LogSidePanelElements';
import {
  HTTP_REQUEST_HEADER_PREFIX,
  HTTP_RESPONSE_HEADER_PREFIX,
  HttpHeader,
  parseHttpHeaders,
  toHeaderDisplayCase,
} from '@/utils/httpHeaders';
import { getHttpBody, getHttpBodyTruncation } from '@/utils/httpSpanAttributes';
import type { Attributes } from '@/utils/spanAttributeReaders';

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
  base0D: '#8378FF',
  base0E: '#ae81ff',
  base0F: '#cc6633',
};

/** A collapsed table of headers or RPC metadata; hidden when empty. */
export function HeaderSection({
  title,
  headers,
}: {
  title: string;
  headers: HttpHeader[];
}) {
  if (headers.length === 0) {
    return null;
  }
  return (
    <CollapsibleSection
      title={`${title} (${headers.length})`}
      initiallyCollapsed
    >
      <SectionWrapper>
        <Table
          borderless
          hideHeader
          density="compact"
          columns={headerColumns}
          data={headers}
        />
      </SectionWrapper>
    </CollapsibleSection>
  );
}

function BodySection({
  attributes,
  direction,
}: {
  attributes: Attributes;
  direction: 'request' | 'response';
}) {
  const body = getHttpBody(attributes, direction);
  if (body == null) {
    return null;
  }
  const title = `${upperFirst(direction)} body`;
  const truncation = getHttpBodyTruncation(attributes, direction);
  return (
    <CollapsibleSection
      title={truncation ? `${title} (truncated: ${truncation})` : title}
    >
      <SectionWrapper>
        <NetworkBody
          body={body}
          theme={JSON_TREE_THEME}
          emptyMessage={`Empty ${direction}`}
          notCollectedMessage={`No ${direction} body collected`}
        />
      </SectionWrapper>
    </CollapsibleSection>
  );
}

/**
 * HTTP headers and bodies, each in a collapsible section, after any
 * `children` sections (e.g. RPC metadata).
 */
export function HttpMessageSections({
  attributes,
  children,
}: {
  attributes: Attributes;
  children?: ReactNode;
}) {
  return (
    // A block wrapper so the sections' margins collapse inside a flex Stack.
    <div>
      {children}
      <HeaderSection
        title="Request headers"
        headers={parseHttpHeaders(attributes, HTTP_REQUEST_HEADER_PREFIX).map(
          toHeaderDisplayCase,
        )}
      />
      <BodySection attributes={attributes} direction="request" />
      <HeaderSection
        title="Response headers"
        headers={parseHttpHeaders(attributes, HTTP_RESPONSE_HEADER_PREFIX).map(
          toHeaderDisplayCase,
        )}
      />
      <BodySection attributes={attributes} direction="response" />
    </div>
  );
}
