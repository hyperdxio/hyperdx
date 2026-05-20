(() => {
  const $ = (sel) => document.querySelector(sel);
  const el = (tag, attrs = {}, ...children) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') n.className = v;
      else if (k === 'html') n.innerHTML = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else if (v === true) n.setAttribute(k, '');
      else if (v != null && v !== false) n.setAttribute(k, v);
    }
    for (const c of children.flat()) {
      if (c == null || c === false) continue;
      n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return n;
  };

  const state = {
    batches: [],
    batch: null,
    cells: [],
    selectedRun: null, // { scenario, mcp, idx }
    runData: null, // { trajectory, grade }
    activeTab: 'trajectory',
  };

  // ----- formatting helpers -----

  const fmtMs = (ms) => {
    if (ms == null) return '—';
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60_000).toFixed(1)}m`;
  };

  const fmtScore = (s) => (s == null ? '—' : s.toFixed(2));

  const scoreClass = (s, max = 1) => {
    if (s == null) return '';
    const n = s / max;
    if (n <= 0.01) return 'bad';
    if (n < 0.5) return 'warn';
    return 'good';
  };

  const criterionClass = (s) => {
    if (s == null) return '';
    if (s === 0) return 'score-0';
    if (s <= 1) return 'score-low';
    if (s <= 2) return 'score-mid';
    return 'score-high';
  };

  const stringifyMaybe = (v) => {
    if (v == null) return '';
    if (typeof v === 'string') return v;
    try {
      return JSON.stringify(v, null, 2);
    } catch {
      return String(v);
    }
  };

  // Tool results come back in a few shapes:
  //  - already an object/array (from toolCalls[].input)
  //  - a JSON-encoded string
  //  - newline-delimited JSON (ToolSearch output)
  //  - an array of {type:"text", text:"..."} content blocks (raw tool_result)
  // Render them as pretty-printed JSON where possible, with text blocks unwrapped.
  const tryParseJson = (s) => {
    if (typeof s !== 'string') return undefined;
    const t = s.trim();
    if (!t || (t[0] !== '{' && t[0] !== '[' && t[0] !== '"')) return undefined;
    try {
      return JSON.parse(t);
    } catch {
      return undefined;
    }
  };

  const prettyJson = (v) => {
    try {
      return JSON.stringify(v, null, 2);
    } catch {
      return String(v);
    }
  };

  const formatToolPayload = (v) => {
    if (v == null) return '';

    // Object / array: pretty-print directly, but unwrap content-block arrays.
    if (typeof v === 'object') {
      if (
        Array.isArray(v) &&
        v.length > 0 &&
        v.every(
          (b) => b && typeof b === 'object' && b.type === 'text' && 'text' in b,
        )
      ) {
        return v
          .map((b) => {
            const inner = tryParseJson(b.text);
            return inner !== undefined ? prettyJson(inner) : b.text;
          })
          .join('\n\n');
      }
      return prettyJson(v);
    }

    if (typeof v !== 'string') return String(v);

    const trimmed = v.trim();
    if (!trimmed) return v;

    // Whole-string JSON.
    const parsed = tryParseJson(trimmed);
    if (parsed !== undefined) return prettyJson(parsed);

    // Newline-delimited JSON (e.g. ToolSearch).
    const lines = trimmed.split('\n');
    if (lines.length > 1) {
      const objs = [];
      let allParsed = true;
      for (const line of lines) {
        const p = tryParseJson(line);
        if (p === undefined) {
          allParsed = false;
          break;
        }
        objs.push(p);
      }
      if (allParsed) return objs.map(prettyJson).join('\n');
    }

    // <persisted-output> wrapper with an embedded JSON preview.
    const previewMatch = v.match(
      /^(<persisted-output>[\s\S]*?Preview \(first [^)]+\):\n)([\s\S]*?)(\n\.\.\.\n<\/persisted-output>)$/,
    );
    if (previewMatch) {
      const [, header, body, footer] = previewMatch;
      const previewParsed = tryParseJson(body);
      if (previewParsed !== undefined) {
        return header + prettyJson(previewParsed) + footer;
      }
    }

    return v;
  };

  // ----- data loading -----

  async function fetchJson(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    return r.json();
  }

  async function loadBatches() {
    const data = await fetchJson('/api/batches');
    state.batches = data.batches;
    renderBatchPicker();
    if (state.batches.length) await loadBatch(state.batches[0].name);
  }

  async function loadBatch(batchName) {
    const data = await fetchJson(`/api/batches/${encodeURIComponent(batchName)}`);
    state.batch = data.batch;
    state.cells = data.cells || [];
    state.summary = data.summary;
    renderBatchMeta();
    renderNav();
  }

  async function loadRun(scenario, mcp, idx) {
    state.selectedRun = { scenario, mcp, idx };
    const u = `/api/batches/${encodeURIComponent(state.batch)}/runs/${encodeURIComponent(scenario)}/${encodeURIComponent(mcp)}/${idx}`;
    state.runData = await fetchJson(u);
    renderNav();
    renderRun();
  }

  // ----- rendering: header -----

  function renderBatchPicker() {
    const sel = $('#batch-select');
    sel.innerHTML = '';
    for (const b of state.batches) {
      sel.appendChild(el('option', { value: b.name }, b.name));
    }
    sel.onchange = () => loadBatch(sel.value);
  }

  function renderBatchMeta() {
    const sc = state.summary?.scenarios?.length ?? state.cells.length;
    const cells = state.cells.length;
    $('#batch-meta').textContent = `${sc} scenario(s) · ${cells} cell(s)`;
  }

  // ----- rendering: sidebar nav -----

  function renderNav() {
    const root = $('#nav');
    root.innerHTML = '';

    const byScenario = new Map();
    for (const c of state.cells) {
      if (!byScenario.has(c.scenario)) byScenario.set(c.scenario, []);
      byScenario.get(c.scenario).push(c);
    }

    for (const [scenario, cells] of byScenario) {
      const sNode = el(
        'div',
        { class: 'nav-scenario' },
        el('div', { class: 'head' }, scenario),
      );
      for (const c of cells) {
        const mNode = el(
          'div',
          { class: 'nav-mcp' },
          el('div', { class: 'head' }, c.mcp),
        );
        for (const r of c.runs) {
          const active =
            state.selectedRun &&
            state.selectedRun.scenario === scenario &&
            state.selectedRun.mcp === c.mcp &&
            state.selectedRun.idx === r.idx;
          const chip = el(
            'span',
            { class: `score-chip ${scoreClass(r.combinedScore)}` },
            fmtScore(r.combinedScore),
          );
          const errBadge =
            r.toolErrors > 0
              ? el('span', { class: 'tag error' }, `${r.toolErrors}!`)
              : null;
          const termBadge =
            r.termination && r.termination !== 'final_answer'
              ? el('span', { class: 'tag' }, r.termination)
              : null;
          const node = el(
            'div',
            {
              class: `nav-run ${active ? 'active' : ''}`,
              onclick: () => loadRun(scenario, c.mcp, r.idx),
            },
            el(
              'span',
              {},
              `#${r.idx}`,
              ' ',
              el('span', { class: 'muted small' }, `${r.toolCalls ?? '?'} calls`),
            ),
            el('span', {}, termBadge, ' ', errBadge, ' ', chip),
          );
          mNode.appendChild(node);
        }
        sNode.appendChild(mNode);
      }
      root.appendChild(sNode);
    }
  }

  // ----- rendering: run -----

  function renderRun() {
    $('#empty').hidden = true;
    $('#run').hidden = false;

    const { trajectory: t, grade } = state.runData;

    // header strip
    const hdr = $('#run-header');
    hdr.innerHTML = '';
    const fields = [
      ['scenario', t.scenario],
      ['mcp', t.mcp],
      ['run', `#${t.runIndex} · seed ${t.seed ?? '—'}`],
      ['model', t.model || '—'],
      ['termination', t.termination || '—'],
      ['duration', fmtMs(t.durationMs)],
      ['tool calls', String(t.toolCalls?.length ?? 0)],
      [
        'tool errors',
        grade?.toolErrors
          ? `${grade.toolErrors.errors}/${grade.toolErrors.total}`
          : '—',
      ],
      [
        'combined',
        grade?.combinedScore != null ? grade.combinedScore.toFixed(3) : '—',
      ],
    ];
    for (const [k, v] of fields) {
      hdr.appendChild(
        el(
          'div',
          {},
          el('div', { class: 'label' }, k),
          el('div', { class: 'value' }, String(v)),
        ),
      );
    }

    renderTrajectory();
    renderAnswer();
    renderGrading();
    renderRaw();

    activateTab(state.activeTab);
  }

  function activateTab(name) {
    state.activeTab = name;
    for (const t of document.querySelectorAll('.tab')) {
      t.classList.toggle('active', t.dataset.tab === name);
    }
    for (const p of document.querySelectorAll('.tab-pane')) {
      p.classList.toggle('active', p.id === `tab-${name}`);
    }
  }

  // Build a unified trajectory from trajectory.messages, mixing thinking text,
  // assistant text, and tool calls (with their results inline). Falls back to
  // toolCalls[] when messages aren't structured the expected way.
  function buildEvents(t) {
    const events = [];
    const toolResults = new Map(); // tool_use_id -> content

    if (Array.isArray(t.messages)) {
      // First pass: collect tool_result blocks (sent in user messages)
      for (const msg of t.messages) {
        if (msg.type === 'user' && msg.message?.content) {
          const content = msg.message.content;
          if (Array.isArray(content)) {
            for (const b of content) {
              if (b.type === 'tool_result') {
                toolResults.set(b.tool_use_id, {
                  content: b.content,
                  isError: !!b.is_error,
                });
              }
            }
          }
        }
      }
      // Second pass: emit thinking/text/tool_use in assistant order
      for (const msg of t.messages) {
        if (msg.type !== 'assistant') continue;
        const content = msg.message?.content;
        if (!Array.isArray(content)) continue;
        for (const b of content) {
          if (b.type === 'thinking') {
            events.push({ kind: 'thinking', text: b.thinking });
          } else if (b.type === 'text') {
            events.push({ kind: 'text', text: b.text });
          } else if (b.type === 'tool_use') {
            const result = toolResults.get(b.id);
            events.push({
              kind: 'tool',
              name: b.name,
              input: b.input,
              output: result?.content,
              isError: result?.isError || false,
              id: b.id,
            });
          }
        }
      }
    }

    // Fallback: messages didn't give us tool calls — use toolCalls array.
    const toolEventCount = events.filter((e) => e.kind === 'tool').length;
    if (toolEventCount === 0 && Array.isArray(t.toolCalls)) {
      for (const c of t.toolCalls) {
        events.push({
          kind: 'tool',
          name: c.name,
          input: c.input,
          output: c.output,
          isError: c.isError || false,
        });
      }
    }
    return events;
  }

  function renderTrajectory() {
    const t = state.runData.trajectory;
    const events = buildEvents(t);
    const list = $('#trajectory');

    const hideToolSearch = $('#hide-toolsearch').checked;
    const errorsOnly = $('#errors-only').checked;
    const filter = $('#traj-filter').value.trim().toLowerCase();

    list.innerHTML = '';
    let toolIdx = 0;
    for (const e of events) {
      let visible = true;
      if (e.kind === 'tool') {
        toolIdx++;
        if (hideToolSearch && e.name === 'ToolSearch') visible = false;
        if (errorsOnly && !e.isError) visible = false;
        if (filter) {
          const hay = (
            e.name +
            '\n' +
            formatToolPayload(e.input) +
            '\n' +
            formatToolPayload(e.output)
          ).toLowerCase();
          if (!hay.includes(filter)) visible = false;
        }
      } else {
        if (errorsOnly) visible = false;
        if (filter && !e.text?.toLowerCase().includes(filter)) visible = false;
      }
      if (!visible) continue;

      if (e.kind === 'thinking') {
        list.appendChild(
          el('li', {}, el('div', { class: 'thinking' }, e.text)),
        );
      } else if (e.kind === 'text') {
        list.appendChild(
          el('li', {}, el('div', { class: 'assistant-text' }, e.text)),
        );
      } else if (e.kind === 'tool') {
        list.appendChild(renderCall(toolIdx, e));
      }
    }
  }

  function renderCall(idx, c) {
    const inputStr = formatToolPayload(c.input);
    const outputStr = formatToolPayload(c.output);
    const summary =
      inputStr.length > 200 ? inputStr.slice(0, 200) + '…' : inputStr;

    const body = el(
      'div',
      { class: 'body' },
      el('h4', {}, 'Input'),
      el('pre', { class: 'code' }, inputStr || '(none)'),
      el('h4', {}, c.isError ? 'Output (ERROR)' : 'Output'),
      el(
        'pre',
        { class: 'code' + (c.isError ? ' error' : '') },
        outputStr || '(none)',
      ),
    );

    const li = el(
      'li',
      { class: 'call' + (c.isError ? ' error' : '') },
      el(
        'div',
        {
          class: 'head',
          onclick: (ev) => {
            ev.currentTarget.parentElement.classList.toggle('open');
          },
        },
        el('span', { class: 'idx' }, `#${idx}`),
        el('span', { class: 'name' + (c.isError ? ' error' : '') }, c.name),
        el('span', { class: 'summary' }, summary.replace(/\s+/g, ' ')),
        c.isError ? el('span', { class: 'tag error' }, 'ERROR') : null,
      ),
      body,
    );
    return li;
  }

  function renderAnswer() {
    const t = state.runData.trajectory;
    const pane = $('#tab-answer');
    pane.innerHTML = '';
    pane.appendChild(
      el(
        'div',
        { class: 'grade-section' },
        el('h3', {}, 'Agent Prompt'),
        el('pre', {}, t.agentPrompt || '(none)'),
      ),
    );
    pane.appendChild(
      el(
        'div',
        { class: 'grade-section' },
        el('h3', {}, 'Final Answer'),
        el('pre', {}, t.finalAnswer || '(no final answer)'),
      ),
    );
    if (t.systemPromptAppend) {
      pane.appendChild(
        el(
          'div',
          { class: 'grade-section' },
          el('h3', {}, 'System Prompt Append'),
          el('pre', {}, t.systemPromptAppend),
        ),
      );
    }
  }

  function renderGrading() {
    const g = state.runData.grade;
    const pane = $('#tab-grading');
    pane.innerHTML = '';

    if (!g) {
      pane.appendChild(el('div', { class: 'muted' }, 'No grade file.'));
      return;
    }

    // Combined
    pane.appendChild(
      el(
        'div',
        { class: 'grade-section' },
        el(
          'h3',
          {},
          'Combined Score',
          el('span', { class: 'score' }, fmtScore(g.combinedScore)),
        ),
        el(
          'div',
          { class: 'muted' },
          `Programmatic ${fmtScore(g.programmatic?.score)} · Judge ${fmtScore(g.judge?.weightedScore)} · Tool error penalty ${fmtScore(g.toolErrors?.penalty)}`,
        ),
      ),
    );

    // Programmatic checks
    if (g.programmatic?.hits) {
      const checks = el('div', { class: 'grade-section' });
      checks.appendChild(
        el(
          'h3',
          {},
          'Programmatic checks',
          el(
            'span',
            { class: 'score' },
            fmtScore(g.programmatic.score),
          ),
        ),
      );
      for (const h of g.programmatic.hits) {
        const good = !!h.satisfied;
        checks.appendChild(
          el(
            'div',
            { class: 'check' + (h.negative ? ' negative' : '') },
            el(
              'div',
              { class: 'marker ' + (good ? 'good' : 'bad') },
              good ? '✓' : '✗',
            ),
            el('div', { class: 'id' }, h.id),
            el(
              'div',
              { class: 'weight' },
              `w${h.weight}${h.matched != null ? ` · matched=${h.matched}` : ''}`,
            ),
          ),
        );
      }
      checks.appendChild(
        el(
          'div',
          { class: 'muted small', style: 'margin-top:0.6rem; font-size:11px' },
          'Negative checks score points when NOT matched — they punish false attribution to distractors.',
        ),
      );
      pane.appendChild(checks);
    }

    // Judge scores
    if (g.judge?.scores) {
      const judge = el('div', { class: 'grade-section' });
      judge.appendChild(
        el(
          'h3',
          {},
          `LLM Judge (${g.judge.model || 'model?'})`,
          el('span', { class: 'score' }, fmtScore(g.judge.weightedScore)),
        ),
      );
      for (const [name, val] of Object.entries(g.judge.scores)) {
        judge.appendChild(
          el(
            'div',
            { class: 'criterion' },
            el(
              'div',
              { class: 'criterion-head' },
              el('div', { class: 'criterion-name' }, name),
              el(
                'div',
                { class: 'criterion-score ' + criterionClass(val.score) },
                `${val.score} / 4`,
              ),
            ),
            el('div', { class: 'rationale' }, val.rationale || ''),
          ),
        );
      }
      pane.appendChild(judge);
    }

    // Tool errors detail
    if (g.toolErrors) {
      const te = el('div', { class: 'grade-section' });
      te.appendChild(
        el(
          'h3',
          {},
          'Tool errors',
          el(
            'span',
            { class: 'score' },
            `${g.toolErrors.errors}/${g.toolErrors.total} (penalty ${fmtScore(g.toolErrors.penalty)})`,
          ),
        ),
      );
      if (g.toolErrors.samples?.length) {
        te.appendChild(
          el(
            'pre',
            { class: 'code' },
            stringifyMaybe(g.toolErrors.samples),
          ),
        );
      } else {
        te.appendChild(el('div', { class: 'muted' }, 'No error samples.'));
      }
      pane.appendChild(te);
    }
  }

  function renderRaw() {
    const pane = $('#tab-raw');
    pane.innerHTML = '';
    pane.appendChild(
      el(
        'div',
        { class: 'grade-section' },
        el('h3', {}, 'trajectory.json'),
        el('pre', {}, stringifyMaybe(state.runData.trajectory)),
      ),
    );
    pane.appendChild(
      el(
        'div',
        { class: 'grade-section' },
        el('h3', {}, 'grade.json'),
        el('pre', {}, stringifyMaybe(state.runData.grade)),
      ),
    );
  }

  // ----- wiring -----

  for (const btn of document.querySelectorAll('.tab')) {
    btn.addEventListener('click', () => activateTab(btn.dataset.tab));
  }
  for (const id of ['hide-toolsearch', 'errors-only']) {
    $('#' + id).addEventListener('change', () => {
      if (state.runData) renderTrajectory();
    });
  }
  $('#traj-filter').addEventListener('input', () => {
    if (state.runData) renderTrajectory();
  });

  loadBatches().catch((e) => {
    $('#empty').textContent = `Error loading batches: ${e.message}`;
  });
})();
