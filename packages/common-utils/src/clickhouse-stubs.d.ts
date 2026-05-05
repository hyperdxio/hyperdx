// NOTE (Berg / Task 2): The runtime ClickHouse client packages
// (@clickhouse/client, @clickhouse/client-web) have been removed.  These
// declarations stub them out so the existing src/clickhouse/* modules can
// still type-check while Task 4 swaps the entire ClickHouse surface for the
// Athena client.  Delete this file as part of Task 4.
declare module '@clickhouse/client' {
  export const createClient: any;

  export type ClickHouseClient = any;

  const _exports: any;
  export default _exports;
}

declare module '@clickhouse/client-web' {
  export const createClient: any;

  export type ClickHouseClient = any;

  export type WebClickHouseClient = any;

  const _exports: any;
  export default _exports;
}
