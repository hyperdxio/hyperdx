import {
  buildCreateDashboardPrompt,
  buildDashboardExamplesPrompt,
  buildQueryGuidePrompt,
} from '@/mcp/prompts/dashboards/content';
import { buildSourceSummary } from '@/mcp/prompts/dashboards/helpers';

describe('MCP Dashboard Prompts', () => {
  describe('buildQueryGuidePrompt', () => {
    it('documents heatmap in tile-type, constraints, mistakes, and aggFn sections', () => {
      const prompt = buildQueryGuidePrompt();
      // Ensure each section the bot called out has a heatmap entry so
      // the LLM cannot skip the constraints when producing a heatmap
      // tile through clickstack_save_dashboard.
      const sections = [
        '== AGGREGATION FUNCTIONS (aggFn) ==',
        '== PER-TILE TYPE CONSTRAINTS ==',
        '== COMMON MISTAKES ==',
      ];
      for (const heading of sections) {
        const idx = prompt.indexOf(heading);
        expect(idx).toBeGreaterThan(-1);
        // Each section's body extends until the next == heading or the
        // end of the string. Checking for the substring "heatmap" in
        // that slice is enough to assert the heatmap entry exists.
        const next = prompt.indexOf('\n== ', idx + heading.length);
        const body = prompt.slice(idx, next === -1 ? prompt.length : next);
        expect(body.toLowerCase()).toContain('heatmap');
      }
    });

    it('documents the dashboard filter and per-series numberFormat sections', () => {
      const prompt = buildQueryGuidePrompt();
      // Sections must exist AND carry the substantive content. Heading-
      // only assertions let a future contributor empty out a section
      // and silently pass review.
      const sliceSection = (heading: string) => {
        const idx = prompt.indexOf(heading);
        if (idx === -1) return '';
        const next = prompt.indexOf('\n== ', idx + heading.length);
        return prompt.slice(idx, next === -1 ? prompt.length : next);
      };
      const filters = sliceSection('== DASHBOARD FILTERS ==');
      expect(filters).toContain('QUERY_EXPRESSION');
      expect(filters).toContain('expression');
      expect(filters).toContain('sourceId');
      const numberFormat = sliceSection('== NUMBER FORMAT ==');
      expect(numberFormat).toContain('factor: 0.000000001');
      expect(numberFormat).toContain('duration');
      expect(numberFormat.toLowerCase()).toContain('per-series');
    });

    it('documents the metric-source builder support with the discovery workflow', () => {
      // Builder tiles on a metric source now work via the metricType +
      // metricName + isDelta fields on each select item, with metricTables
      // threaded through runConfigTile's builder branch. The prompt has to
      // teach the model the discovery workflow (list_sources -> describe
      // _source -> list_metrics -> describe_metric -> timeseries|table)
      // and the per-kind aggFn rules so it doesn't fall back to raw SQL.
      const prompt = buildQueryGuidePrompt();
      const metricsIdx = prompt.indexOf('== METRIC SOURCES ==');
      expect(metricsIdx).toBeGreaterThan(-1);
      const metricsBody = prompt.slice(
        metricsIdx,
        prompt.indexOf('\n== ', metricsIdx + 1),
      );
      // The four supported metric select fields are named.
      expect(metricsBody).toContain('metricType');
      expect(metricsBody).toContain('metricName');
      expect(metricsBody).toContain('isDelta');
      // Per-kind aggregation guidance is present.
      expect(metricsBody).toMatch(/gauge\s+Use aggFn:"last_value"/);
      expect(metricsBody).toMatch(/sum\s+Use aggFn:"increase"/);
      expect(metricsBody).toMatch(/histogram\s+Use aggFn:"quantile"/);
      expect(metricsBody).toMatch(
        /exponential histogram\s+Use aggFn:"quantile"/,
      );
      // The 20-group cap on increase + groupBy is documented.
      expect(metricsBody).toMatch(/top 20 groups/);
      // The four-tool discovery chain is documented in order.
      expect(metricsBody).toContain('clickstack_describe_source');
      expect(metricsBody).toContain('clickstack_list_metrics');
      expect(metricsBody).toContain('clickstack_describe_metric');
      // The old "use raw SQL for metric tiles" workaround language is gone.
      expect(prompt).not.toMatch(
        /Authoring builder tiles on a metric source is not reliable/,
      );
      expect(prompt).not.toMatch(/Both table name and UUID are empty/);
    });

    it('documents table-tile onClick linking features', () => {
      // Lock down the documentation for row-click drill-downs so a
      // future refactor can't quietly drop the section the LLM relies
      // on to wire up onClick correctly.
      const prompt = buildQueryGuidePrompt();
      const idx = prompt.indexOf('== TABLE TILE LINKING (config.onClick) ==');
      expect(idx).toBeGreaterThan(-1);
      const next = prompt.indexOf('\n== ', idx + 1);
      const section = prompt.slice(idx, next === -1 ? prompt.length : next);

      // All destination types are mentioned.
      expect(section).toContain('type: "search"');
      expect(section).toContain('type: "dashboard"');
      expect(section).toContain('type: "external"');
      expect(section).toContain('urlTemplate');
      // Both target modes are mentioned.
      expect(section).toContain('mode: "id"');
      expect(section).toContain('mode: "template"');
      // Templating fields are mentioned.
      expect(section).toContain('whereTemplate');
      expect(section).toContain('filters');
      expect(section).toContain('expressionTemplate');
      // The two server-side validation error messages are quoted so
      // the LLM can recognize and recover from them.
      expect(section).toContain('onClick search source IDs');
      expect(section).toContain('onClick dashboard IDs');
    });

    it('documents onClick pitfalls under common mistakes', () => {
      const prompt = buildQueryGuidePrompt();
      const idx = prompt.indexOf('== COMMON MISTAKES ==');
      expect(idx).toBeGreaterThan(-1);
      const section = prompt.slice(idx);
      // Mention the four failure modes we hit during validation.
      expect(section.toLowerCase()).toContain('onclick on a non-table tile');
      expect(section.toLowerCase()).toContain('non-log/trace source');
      expect(section.toLowerCase()).toContain('missing wherelanguage');
      expect(section.toLowerCase()).toContain("isn't in the table");
    });

    it('documents the missing-alias mistake explicitly', () => {
      // Claude built three number tiles without alias on the quantile()
      // select item, even though rule 2 of the design checklist says
      // ALIAS EVERY SELECT ITEM. Spelling out the mistake under COMMON
      // MISTAKES gives the model a second touchpoint to catch it.
      const prompt = buildQueryGuidePrompt();
      const idx = prompt.indexOf('== COMMON MISTAKES ==');
      const section = prompt.slice(idx);
      expect(section).toMatch(/Missing alias on a select item/);
      // Must call out that number tiles need the alias too; this is the
      // exact case Claude got wrong.
      expect(section).toMatch(/number tiles too/);
    });

    it('documents the Lucene map-attribute gotcha across all operators including simple equality', () => {
      // The original rule covered only comparison/wildcard. Claude's
      // second pass showed simple equality (db.system:mongodb) also
      // fails to translate to SpanAttributes['db.system']. Broaden the
      // gotcha to "ALL Lucene operations on map-attribute paths".
      const prompt = buildQueryGuidePrompt();
      const luceneIdx = prompt.indexOf('== LUCENE FILTER SYNTAX ==');
      const luceneBody = prompt.slice(luceneIdx);
      expect(luceneBody).toMatch(/NOT reliably translated to bracket access/);
      expect(luceneBody).toMatch(/http\.status_code:>=500/); // operator
      expect(luceneBody).toMatch(/http\.route:\*/); // wildcard
      expect(luceneBody).toMatch(/db\.system:mongodb/); // simple equality
      expect(luceneBody).toMatch(/use SQL with bracket access/);

      // Also a top-level entry in COMMON MISTAKES for discoverability.
      const mistakesIdx = prompt.indexOf('== COMMON MISTAKES ==');
      const mistakesBody = prompt.slice(mistakesIdx);
      expect(mistakesBody).toMatch(
        /Lucene on a map-attribute path \(any operation\)/,
      );
    });

    it('documents the Lucene fuzzy-substring behavior on top-level columns', () => {
      // Lucene field:value translates to ilike(field, '%value%'), not
      // equality. Claude's second pass hit this on SpanKind:Server,
      // which matched broader strings than intended. The note has to
      // be in the Lucene section so a model reading top-down sees it
      // before writing a SpanKind filter.
      const prompt = buildQueryGuidePrompt();
      const luceneIdx = prompt.indexOf('== LUCENE FILTER SYNTAX ==');
      const luceneBody = prompt.slice(luceneIdx);
      expect(luceneBody).toMatch(/SUBSTRING MATCHING/);
      expect(luceneBody).toMatch(/ilike\(field, '%value%'\)/);
      // The canonical fix is SQL with =.
      expect(luceneBody).toMatch(/SpanKind = 'Server'/);
      // Wildcard limitation is documented alongside substring matching.
      expect(luceneBody).toMatch(/prefix-within-substring/);
      expect(luceneBody).toMatch(/LIKE 'api%'/);

      // And a COMMON MISTAKES entry covering enum-like columns and wildcards.
      const mistakesIdx = prompt.indexOf('== COMMON MISTAKES ==');
      const mistakesBody = prompt.slice(mistakesIdx);
      expect(mistakesBody).toMatch(/Lucene field:value and field:value\*/);
    });

    it('documents the empty-string trap for map-attribute groupBy', () => {
      // Map columns return '' (not NULL) when a key is unset on a row.
      // A groupBy on such a key produces an empty-string bucket alongside
      // the real values, which is visual noise on tables and pies. The
      // standard fix is where: "<map-attr> != ''" alongside the groupBy.
      const prompt = buildQueryGuidePrompt();
      const mistakesIdx = prompt.indexOf('== COMMON MISTAKES ==');
      const mistakesBody = prompt.slice(mistakesIdx);
      expect(mistakesBody).toMatch(
        /Forgetting that map-attribute values are often empty strings/,
      );
      expect(mistakesBody).toMatch(/db\.collection\.name'\] != ''/);
    });

    it('documents the groupBy alias workaround for map-attribute drill-downs', () => {
      // Builder tiles don't expose a groupBy alias today; map-attribute
      // groupBys produce result columns named like the raw expression,
      // which onClick template lookups can't reference. The workaround
      // (author the tile as raw SQL with AS) needs to be findable.
      const prompt = buildQueryGuidePrompt();
      const idx = prompt.indexOf(
        '== GROUPBY ALIASES AND ROW-CLICK TEMPLATES ==',
      );
      expect(idx).toBeGreaterThan(-1);
      const section = prompt.slice(idx);
      expect(section).toMatch(/do NOT currently expose a groupBy alias/);
      expect(section).toMatch(/configType: "sql", displayType: "table"/);
      expect(section).toMatch(/AS Route/);
    });

    it('points at ClickStack and ClickHouse docs in REFERENCES', () => {
      // Without external doc links, the LLM has to guess at Lucene
      // operators and ClickHouse function names. Anchor the canonical
      // URLs in the prompt so it can cite them and so a future doc
      // restructure can be caught here.
      const prompt = buildQueryGuidePrompt();
      const idx = prompt.indexOf('== REFERENCES ==');
      expect(idx).toBeGreaterThan(-1);
      const section = prompt.slice(idx);
      expect(section).toContain(
        'https://clickhouse.com/docs/use-cases/observability/clickstack/search',
      );
      expect(section).toContain('https://clickhouse.com/docs/sql-reference');
      expect(section).toContain(
        'https://clickhouse.com/docs/use-cases/observability/clickstack/dashboards/sql-visualizations',
      );
    });

    it('strengthens the validate-every-tile rule under common mistakes', () => {
      // Saving validates input shape, not query semantics. The prompt
      // has to push for query_tile on every tile, not "at least one".
      const prompt = buildQueryGuidePrompt();
      const mistakesIdx = prompt.indexOf('== COMMON MISTAKES ==');
      const section = prompt.slice(mistakesIdx);
      expect(section).toMatch(
        /on EVERY tile after clickstack_save_dashboard, not just one/,
      );
    });

    it('walks the metric discovery workflow end-to-end with worked examples', () => {
      // Metric source builder tiles now work — the prompt teaches the
      // model how to find, characterise, and chart a metric without
      // falling through to raw SQL. The examples cover one tile per
      // supported metric kind so the pattern is unambiguous.
      const prompt = buildQueryGuidePrompt();
      const metricsIdx = prompt.indexOf('== METRIC SOURCES ==');
      const metricsBody = prompt.slice(
        metricsIdx,
        prompt.indexOf('\n== ', metricsIdx + 1),
      );
      // The five-step discovery workflow is enumerated.
      expect(metricsBody).toMatch(/clickstack_list_sources/);
      expect(metricsBody).toMatch(/clickstack_describe_source/);
      expect(metricsBody).toMatch(/clickstack_list_metrics/);
      expect(metricsBody).toMatch(/clickstack_describe_metric/);
      expect(metricsBody).toMatch(/clickstack_timeseries/);
      // One worked example per supported kind, each using a real OTel
      // metric name so the agent has a concrete template.
      expect(metricsBody).toContain('system.cpu.utilization');
      expect(metricsBody).toContain('http.server.request.count');
      expect(metricsBody).toContain('http.server.request.duration');
      // valueExpression default is documented.
      expect(metricsBody).toMatch(/valueExpression defaults to "Value"/);
    });

    it('contains no em-dashes or en-dashes used as em-dashes', () => {
      const prompt = buildQueryGuidePrompt();
      expect(prompt).not.toMatch(/\u2014/); // [prose-lint: allow]
      expect(prompt).not.toMatch(/ \u2013 /); // [prose-lint: allow]
    });
  });

  describe('buildSourceSummary', () => {
    it('contains no em-dashes or en-dashes used as em-dashes', () => {
      // buildSourceSummary is the source-list block that gets prepended
      // to create_dashboard. The first iteration of this PR shipped with
      // em-dashes here that the content.ts snapshot test missed because
      // it calls the builders directly. Guard the helper output too.
      const summary = buildSourceSummary(
        [
          {
            _id: '000000000000000000000001',
            name: 'Traces',
            kind: 'trace',
            connection: '000000000000000000000002',
          },
          {
            _id: '000000000000000000000003',
            name: 'Logs',
            kind: 'log',
            connection: '000000000000000000000002',
          },
        ],
        [{ _id: '000000000000000000000002', name: 'Default' }],
      );
      expect(summary).not.toMatch(/\u2014/); // [prose-lint: allow]
      expect(summary).not.toMatch(/ \u2013 /); // [prose-lint: allow]
      // Sanity: the helper still emits the source list, so the assertion
      // above isn't trivially passing on an empty string.
      expect(summary).toContain('Traces');
      expect(summary).toContain('AVAILABLE SOURCES');
    });
  });

  describe('buildCreateDashboardPrompt', () => {
    it('includes the design checklist and adapt-do-not-copy note', () => {
      const prompt = buildCreateDashboardPrompt(
        'sources summary',
        '000000000000000000000001',
        '000000000000000000000002',
      );
      expect(prompt).toContain('== DESIGN CHECKLIST ==');
      // Each rule on the checklist exists at the same numbered position
      // so a future contributor cannot silently drop one. Anchor on
      // line start (with a trailing space) so digit-and-dot substrings
      // like "0.000000001" elsewhere in the prompt cannot satisfy the
      // assertion accidentally.
      const checklistIdx = prompt.indexOf('== DESIGN CHECKLIST ==');
      const adaptIdx = prompt.indexOf('== ADAPT, DO NOT COPY ==');
      const checklistBody = prompt.slice(checklistIdx, adaptIdx);
      // Fourteen rules: the original ten plus GROUP BY HAS NO ALIAS HOOK
      // (rule 3), VALIDATE EVERY TILE AFTER SAVE (rule 12), NO
      // TITLE-RECAP MARKDOWN TILE (rule 13), and SIZE TILES TO FIT THEIR
      // CONTENT (rule 14). Each came out of a live verification pass after
      // watching Claude reliably ignore the soft "should" formulations or
      // hit a schema gap the earlier checklist did not call out.
      for (let i = 1; i <= 14; i++) {
        expect(checklistBody).toMatch(new RegExp(`^${i}\\. `, 'm'));
      }
      expect(prompt).toContain('ADAPT, DO NOT COPY');
      // Rule 9 documents the replace-not-merge semantic on update; an
      // agent that ignores this can silently drop tiles / filters / containers
      // on a subsequent save call.
      expect(checklistBody).toMatch(/UPDATE IS REPLACE, NOT MERGE/);
      // Rule 2 must cover EVERY select item (including number tiles), not
      // just aggregations on tables. The phrasing matters: Claude's first
      // pass at this dropped aliases on number tiles because it read rule 2
      // as table-specific. The stronger phrasing pulls them in.
      expect(checklistBody).toMatch(/ALIAS EVERY SELECT ITEM/);
      // Rule 3 calls out the schema gap on groupBy: the chart config takes
      // a single expression string with no alias field, so a table grouped
      // by SpanAttributes['http.route'] renders arrayElement(...) as the
      // column header. Naming the limit explicitly lets Claude pick a
      // top-level column (SpanName, ServiceName) instead of grouping on
      // the raw Map expression.
      expect(checklistBody).toMatch(/GROUP BY HAS NO ALIAS HOOK/);
      // Rule 10 must be a hard requirement at 5+ tiles, not a soft hint.
      // Without the imperative, Claude built five dashboards averaging ten
      // tiles each with zero containers.
      expect(checklistBody).toMatch(/REQUIRED at five or more tiles/);
      // Rule 11 + 12 close the post-save loop and the title-recap markdown
      // habit Claude landed on every starter dashboard.
      expect(checklistBody).toMatch(/VALIDATE EVERY TILE AFTER SAVE/);
      expect(checklistBody).toMatch(/NO TITLE-RECAP MARKDOWN TILE/);
      // Rule 2 now carries a concrete number-tile example. Claude's
      // second pass still dropped aliases on every builder number tile,
      // because the text rule was abstract; a copy-pasteable shape next
      // to the rule is what makes it stick.
      expect(checklistBody).toMatch(
        /Number tile, correct:.*alias: "Server Requests"/,
      );
      // Rule 10 now carries a concrete containers shape. Claude's
      // second pass built five dashboards with 9-10 tiles each and zero
      // containers despite the REQUIRED phrasing; a copy-pasteable shape
      // inside the rule itself is the next-level push.
      expect(checklistBody).toMatch(/Concrete shape \(copy this directly/);
      expect(checklistBody).toMatch(/id: "kpis"/);
      expect(checklistBody).toMatch(/id: "trends"/);
      expect(checklistBody).toMatch(/id: "errors"/);
      // Rule 14 teaches per-displayType tile sizing. Claude reliably left
      // every tile at the 12x4 default, clipping tables and search lists
      // and leaving number tiles oversized; the rule has to name concrete
      // per-type w/h ranges so the model picks deliberate sizes.
      expect(checklistBody).toMatch(/SIZE TILES TO FIT THEIR CONTENT/);
      expect(checklistBody).toMatch(/number tiles stay small \(w 6-8, h 3-4\)/);
      expect(checklistBody).toMatch(
        /tables and search lists want the full row/,
      );
    });

    it('walks the workflow through six steps including read-existing and group-into-containers', () => {
      // The workflow is the first thing a model anchors on. Claude
      // skipped both "read existing dashboards before designing" and
      // "group tiles into containers before saving" because neither was
      // a numbered workflow step; both lived only in the checklist. The
      // workflow now lists six steps with those two explicitly.
      const prompt = buildCreateDashboardPrompt(
        'summary',
        'trace_src',
        'log_src',
      );
      const wfIdx = prompt.indexOf('== WORKFLOW ==');
      const wfEnd = prompt.indexOf('\n== ', wfIdx + 1);
      const wf = prompt.slice(wfIdx, wfEnd);
      for (let i = 1; i <= 6; i++) {
        expect(wf).toMatch(new RegExp(`^${i}\\. `, 'm'));
      }
      // Step 2 must point at clickstack_get_dashboard with no id.
      expect(wf).toMatch(/clickstack_get_dashboard \(no id\)/);
      // Step 4 must call out grouping tiles into containers before save.
      expect(wf).toMatch(/group them into 2-4 containers/);
      // Step 6 must call out EVERY tile, not just one.
      expect(wf).toMatch(/EVERY tile \(not just one\)/);
    });

    it('warns explicitly against title-recap markdown tiles in the tile type guide', () => {
      // The TILE TYPE GUIDE entry for markdown is where a model reading
      // top-down first decides whether to add an "About this dashboard"
      // tile. The entry has to actively discourage it, not just describe
      // the tile type, because every model trained on dashboard examples
      // reaches for a title tile by default.
      const prompt = buildCreateDashboardPrompt(
        'summary',
        'trace_src',
        'log_src',
      );
      const guideIdx = prompt.indexOf('== TILE TYPE GUIDE ==');
      const guideEnd = prompt.indexOf('\n== ', guideIdx + 1);
      const guideBody = prompt.slice(guideIdx, guideEnd);
      // The markdown line must say "skip" / "sparingly" / "do not" /
      // "no headings", not just "use for notes". Look for the most
      // load-bearing phrase.
      expect(guideBody).toMatch(/Skip markdown tiles for starter dashboards/);
    });

    it('explains the 15-minute default time window UX trap', () => {
      // Empty tiles on a fresh dashboard are usually a time-window problem,
      // not a query problem. The prompt has to surface this so Claude
      // tells the user (rather than silently padding individual tile time
      // ranges to make a 24-hour view fit a 15-minute dashboard frame).
      const prompt = buildCreateDashboardPrompt(
        'summary',
        'trace_src',
        'log_src',
      );
      expect(prompt).toMatch(/DEFAULT TIME WINDOW/);
      expect(prompt).toMatch(/15-minute default window/);
    });

    it('contains no em-dashes or en-dashes used as em-dashes', () => {
      const prompt = buildCreateDashboardPrompt('sources summary', '', '');
      expect(prompt).not.toMatch(/\u2014/); // [prose-lint: allow]
      // En-dash flanked by spaces reads as an em-dash substitute and is
      // disallowed by the voice rules. Numeric ranges (e.g. "1-20") are
      // not in the checklist anyway, but guard against them just in case.
      expect(prompt).not.toMatch(/ \u2013 /); // [prose-lint: allow]
    });

    it("mentions row-click linking in the table tile's description", () => {
      // The create prompt is the LLM's primary entry point for new
      // dashboards. Surface onClick on the TILE TYPE GUIDE so the
      // model considers wiring it up on overview tables without the
      // user having to ask.
      const prompt = buildCreateDashboardPrompt(
        'summary',
        'trace_src',
        'log_src',
      );
      const guideIdx = prompt.indexOf('== TILE TYPE GUIDE ==');
      expect(guideIdx).toBeGreaterThan(-1);
      const guideEnd = prompt.indexOf('\n== ', guideIdx + 1);
      const guideBody = prompt.slice(guideIdx, guideEnd);
      // The table line must hint at onClick and point at the
      // consolidated TABLE TILE LINKING section in the query guide.
      expect(guideBody).toContain('onClick');
      expect(guideBody).toContain('TABLE TILE LINKING');
    });
  });

  describe('buildDashboardExamplesPrompt', () => {
    it('exposes exactly the four verified trace/log examples plus infrastructure_sql', () => {
      const all = buildDashboardExamplesPrompt(
        '000000000000000000000001',
        '000000000000000000000002',
        '000000000000000000000003',
      );
      // Order matters here only to keep the LLM's navigation stable
      // across releases. If the order changes intentionally, update the
      // snapshot.
      const patternLineMatch = all.match(/Available patterns: ([^\n]+)/);
      expect(patternLineMatch).toBeTruthy();
      const patternList = patternLineMatch?.[1].split(', ');
      expect(patternList).toEqual([
        'service_inventory',
        'service_detail',
        'log_analytics',
        'backend_dependencies',
        'drilldown_links',
        'infrastructure_sql',
      ]);
    });

    it('renders each example with a leading "When to use" header', () => {
      const all = buildDashboardExamplesPrompt(
        '000000000000000000000001',
        '000000000000000000000002',
        '000000000000000000000003',
      );
      for (const heading of [
        '== SERVICE INVENTORY ==',
        '== SERVICE DETAIL ==',
        '== LOG ANALYTICS ==',
        '== BACKEND DEPENDENCIES ==',
        '== INFRASTRUCTURE (Raw SQL) ==',
      ]) {
        expect(all).toContain(heading);
      }
      // Each non-SQL example should explain WHEN to reach for it. The
      // SQL example does too, but the heading differs slightly.
      const nonSqlSections = all
        .split('== ')
        .filter(s =>
          [
            'SERVICE INVENTORY',
            'SERVICE DETAIL',
            'LOG ANALYTICS',
            'BACKEND DEPENDENCIES',
          ].some(h => s.startsWith(h)),
        );
      for (const section of nonSqlSections) {
        expect(section.toLowerCase()).toContain('when to use');
      }
    });

    it('returns a single example when filtered by pattern', () => {
      const single = buildDashboardExamplesPrompt(
        '000000000000000000000001',
        '000000000000000000000002',
        '000000000000000000000003',
        'service_inventory',
      );
      expect(single).toContain('== SERVICE INVENTORY ==');
      expect(single).not.toContain('== SERVICE DETAIL ==');
      expect(single).not.toContain('== LOG ANALYTICS ==');
    });

    it('wires service_inventory row-click into the service_detail dashboard', () => {
      // The service_inventory pattern's main RED table should carry an
      // onClick that drills into the partner "Service Detail" dashboard
      // by name template, with a ServiceName filter rendered from the
      // clicked row. Without this wiring, an agent following the canonical
      // workflow would have to invent the drill-down each time and
      // sometimes get the field shape wrong.
      const single = buildDashboardExamplesPrompt(
        '000000000000000000000001',
        '000000000000000000000002',
        '000000000000000000000003',
        'service_inventory',
      );
      // The onClick target points at the partner pattern by name.
      expect(single).toContain(
        'target: { mode: "template", template: "Service Detail" }',
      );
      // The onClick filter expression matches service_detail's filter expression,
      // so the destination dashboard's "Service" dropdown auto-populates.
      expect(single).toContain('expression: "ServiceName"');
      // The template references the row's groupBy column (ServiceName).
      expect(single).toContain('template: "{{ServiceName}}"');
    });

    it('exposes a drilldown_links example pattern with onClick wiring', () => {
      // Drew's drilldown_links example carries a self-contained
      // onClick walkthrough (search drill-down + dashboard drill-down).
      // Keep it discoverable so an agent asked to wire up drill-downs
      // can opt into this example by pattern name.
      const all = buildDashboardExamplesPrompt(
        'trace_src',
        'log_src',
        'conn_id',
      );
      expect(all).toContain('drilldown_links');

      const filtered = buildDashboardExamplesPrompt(
        'trace_src',
        'log_src',
        'conn_id',
        'drilldown_links',
      );
      expect(filtered).toContain('ROW-CLICK DRILL-DOWN LINKS');
      expect(filtered).toContain('onClick');
      expect(filtered).toContain('type: "search"');
      expect(filtered).toContain('type: "dashboard"');
      expect(filtered).toContain('expressionTemplate');
    });

    it('falls back to showing all examples when pattern is unknown', () => {
      const fallback = buildDashboardExamplesPrompt(
        '000000000000000000000001',
        '000000000000000000000002',
        '000000000000000000000003',
        'made_up_pattern',
      );
      expect(fallback).toContain('No example found for pattern');
      // Listing every example name in the fallback gives the LLM a way
      // to recover by re-requesting one of the known patterns.
      expect(fallback).toContain('service_inventory');
      expect(fallback).toContain('service_detail');
    });

    it('contains no em-dashes in any example body', () => {
      const all = buildDashboardExamplesPrompt(
        '000000000000000000000001',
        '000000000000000000000002',
        '000000000000000000000003',
      );
      expect(all).not.toMatch(/\u2014/); // [prose-lint: allow]
    });
  });
});
