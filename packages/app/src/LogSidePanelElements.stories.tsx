import type { Meta } from '@storybook/react';

import { NetworkBody } from './LogSidePanelElements';

const meta: Meta = {
  title: 'LogSidePanelElements',
  component: NetworkBody,
  parameters: {},
};

const MOCK_SQL_BODY = `SELECT
    toUnixTimestamp(toStartOfInterval(timestamp, INTERVAL '10 second')) as ts_bucket,
    if(multiSearchAny(severity_text, ['err', 'emerg', 'alert', 'crit', 'fatal']), 'error', 'info') as severity_group,
    count(*) as count
  FROM default.log_stream
  WHERE (1 = 1) AND ((_timestamp_sort_key >= 1717609920000000000 AND _timestamp_sort_key < 1717610820000000000) AND ((type = 'span')))
  GROUP BY ts_bucket, severity_group
  ORDER BY ts_bucket
  WITH FILL
    FROM toUnixTimestamp(toStartOfInterval(toDateTime(1717609920), INTERVAL '10 second'))
    TO toUnixTimestamp(toStartOfInterval(toDateTime(1717610820), INTERVAL '10 second'))
    STEP 10
  LIMIT 1000 
FORMAT JSON`;

const MOCK_JSON_BODY = `{
  "links": {
    "self": "http://example.com/articles",
    "next": "http://example.com/articles?page[offset]=2",
    "last": "http://example.com/articles?page[offset]=10"
  },
  "data": [{
    "type": "articles",
    "id": "1",
    "attributes": {
      "title": "JSON:API paints my bikeshed!"
    },
    "relationships": {
      "author": {
        "links": {
          "self": "http://example.com/articles/1/relationships/author",
          "related": "http://example.com/articles/1/author"
        },
        "data": { "type": "people", "id": "9" }
      },
      "comments": {
        "links": {
          "self": "http://example.com/articles/1/relationships/comments",
          "related": "http://example.com/articles/1/comments"
        },
        "data": [
          { "type": "comments", "id": "5" },
          { "type": "comments", "id": "12" }
        ]
      }
    },
    "links": {
      "self": "http://example.com/articles/1"
    }
  }],
  "included": [{
    "type": "people",
    "id": "9",
    "attributes": {
      "firstName": "Dan",
      "lastName": "Gebhardt",
      "twitter": "dgeb"
    },
    "links": {
      "self": "http://example.com/people/9"
    }
  }, {
    "type": "comments",
    "id": "5",
    "attributes": {
      "body": "First!"
    },
    "relationships": {
      "author": {
        "data": { "type": "people", "id": "2" }
      }
    },
    "links": {
      "self": "http://example.com/comments/5"
    }
  }, {
    "type": "comments",
    "id": "12",
    "attributes": {
      "body": "I like XML better"
    },
    "relationships": {
      "author": {
        "data": { "type": "people", "id": "9" }
      }
    },
    "links": {
      "self": "http://example.com/comments/12"
    }
  }]
}`;

export const Sql = () => <NetworkBody body={MOCK_SQL_BODY} />;

export const Json = () => <NetworkBody body={MOCK_JSON_BODY} />;

export default meta;
