// A single self-contained page - no build step, no external dependencies,
// no framework - deliberately, same constraint as packetforge's own
// dashboard. Every request it makes is to contrib-radar's own already-
// existing REST API (GET/POST /repos, POST /repos/:id/refresh,
// GET /repos/:id/issues) - no new backend surface exists just for this
// page. i18n is a plain client-side dictionary (EN/ES) swapped via one
// data-i18n attribute pass.
export const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>contrib-radar</title>
<style>
  :root {
    --bg: #0a1210;
    --panel: #101c19;
    --panel-2: #16241f;
    --border: #223530;
    --text: #e7f2ee;
    --text-dim: #8ba79d;
    --accent: #2dd4a7;
    --accent-dim: #1c5c4a;
    --score-high: #4ade80;
    --score-high-bg: rgba(74, 222, 128, 0.14);
    --score-mid: #fbbf24;
    --score-mid-bg: rgba(251, 191, 36, 0.14);
    --score-low: #f87171;
    --score-low-bg: rgba(248, 113, 113, 0.14);
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background: var(--bg);
    color: var(--text);
    font-variant-numeric: tabular-nums;
  }
  header {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 14px 20px;
    background: var(--panel);
    border-bottom: 1px solid var(--border);
    flex-wrap: wrap;
  }
  header h1 {
    font-size: 18px;
    margin: 0;
    font-weight: 700;
    letter-spacing: -0.02em;
    white-space: nowrap;
  }
  header h1 span { color: var(--accent); }
  select, input, button {
    background: var(--panel-2);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 7px 10px;
    font-size: 13px;
    font-family: inherit;
  }
  select { min-width: 200px; }
  input[type="text"] { min-width: 160px; }
  button {
    cursor: pointer;
    background: var(--accent-dim);
    border-color: var(--accent);
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  button:hover:not(:disabled) { background: var(--accent); color: #06110d; }
  button:disabled { opacity: 0.55; cursor: not-allowed; }
  button.ghost { background: transparent; }
  button.ghost:hover:not(:disabled) { background: var(--panel-2); color: var(--text); }
  #headerRight { margin-left: auto; display: flex; align-items: center; gap: 10px; }
  #lastRefreshed { font-size: 12px; color: var(--text-dim); white-space: nowrap; }
  .spinner {
    width: 12px; height: 12px;
    border: 2px solid rgba(255,255,255,0.35);
    border-top-color: #06110d;
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
    display: none;
  }
  button.loading .spinner { display: inline-block; }
  button.loading .btn-label { display: none; }
  @keyframes spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) { .spinner { animation: none; } }

  #addRepoForm {
    display: none;
    gap: 14px;
    align-items: flex-end;
    padding: 14px 20px;
    background: var(--panel-2);
    border-bottom: 1px solid var(--border);
    flex-wrap: wrap;
  }
  #addRepoForm.open { display: flex; }
  .field { display: flex; flex-direction: column; gap: 4px; }
  .field label { font-size: 11px; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.05em; }

  main { padding: 20px; max-width: 1100px; margin: 0 auto; }
  #emptyState, #loadingState {
    padding: 60px 20px;
    text-align: center;
    color: var(--text-dim);
    font-size: 14px;
  }
  #tableWrap { overflow-x: auto; border: 1px solid var(--border); border-radius: 10px; }
  table { width: 100%; border-collapse: collapse; background: var(--panel); }
  th, td { padding: 12px 14px; text-align: left; border-bottom: 1px solid var(--border); vertical-align: top; }
  th {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-dim);
    background: var(--panel-2);
    cursor: pointer;
    user-select: none;
    white-space: nowrap;
  }
  th:hover { color: var(--text); }
  th .sort-arrow { opacity: 0.5; font-size: 10px; margin-left: 4px; }
  tr:last-child td { border-bottom: none; }
  tr:hover td { background: rgba(255,255,255,0.02); }
  .issue-title { color: var(--text); text-decoration: none; font-weight: 600; }
  .issue-title:hover { color: var(--accent); text-decoration: underline; }
  .issue-number { color: var(--text-dim); font-weight: 400; }
  .score-badge {
    display: inline-block;
    min-width: 34px;
    text-align: center;
    padding: 3px 8px;
    border-radius: 999px;
    font-weight: 700;
    font-size: 13px;
  }
  .score-high { color: var(--score-high); background: var(--score-high-bg); }
  .score-mid { color: var(--score-mid); background: var(--score-mid-bg); }
  .score-low { color: var(--score-low); background: var(--score-low-bg); }
  .reasons { display: flex; flex-wrap: wrap; gap: 5px; max-width: 260px; }
  .reason-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 20px; height: 20px;
    border-radius: 5px;
    font-size: 12px;
    cursor: help;
    border: 1px solid var(--border);
  }
  .reason-positive { color: var(--score-high); border-color: var(--score-high); }
  .reason-info { color: var(--text-dim); }
  .reason-warning { color: var(--score-mid); border-color: var(--score-mid); }
  .reason-negative { color: var(--score-low); border-color: var(--score-low); }
  .updated-cell { color: var(--text-dim); font-size: 12px; white-space: nowrap; }
  footer { text-align: center; padding: 24px; color: var(--text-dim); font-size: 12px; }
</style>
</head>
<body>
<header>
  <h1>contrib<span>-radar</span></h1>
  <select id="repoSelect" data-i18n-aria="selectRepo"></select>
  <button id="addRepoToggle" class="ghost" type="button" data-i18n="addRepo">+ Add repo</button>
  <button id="refreshBtn" type="button">
    <span class="spinner"></span>
    <span class="btn-label" data-i18n="refresh">Refresh</span>
  </button>
  <span id="lastRefreshed"></span>
  <div id="headerRight">
    <button id="langToggle" class="ghost" type="button">ES</button>
  </div>
</header>

<div id="addRepoForm">
  <div class="field">
    <label data-i18n="owner">Owner</label>
    <input type="text" id="repoOwner" placeholder="fluxcd" />
  </div>
  <div class="field">
    <label data-i18n="repoName">Repo name</label>
    <input type="text" id="repoName" placeholder="source-controller" />
  </div>
  <div class="field">
    <label data-i18n="labels">Labels (comma-separated)</label>
    <input type="text" id="repoLabels" placeholder="good first issue" />
  </div>
  <button id="addRepoSubmit" type="button" data-i18n="add">Add</button>
</div>

<main>
  <div id="loadingState" data-i18n="loading">Loading...</div>
  <div id="emptyState" style="display:none" data-i18n="emptyState">No watched repos yet - add one above to get started.</div>
  <div id="tableWrap" style="display:none">
    <table>
      <thead>
        <tr>
          <th data-sort="title" data-i18n="issue">Issue</th>
          <th data-sort="score" data-i18n="score">Score</th>
          <th data-i18n="reasons">Reasons</th>
          <th data-sort="githubUpdatedAt" data-i18n="updated">Updated</th>
        </tr>
      </thead>
      <tbody id="issuesBody"></tbody>
    </table>
  </div>
</main>

<footer data-i18n="footer">contrib-radar - verifies real availability and maintainer sentiment, not just labels.</footer>

<script>
(function () {
  const I18N = {
    en: {
      selectRepo: 'Select a watched repo',
      addRepo: '+ Add repo',
      refresh: 'Refresh',
      owner: 'Owner',
      repoName: 'Repo name',
      labels: 'Labels (comma-separated)',
      add: 'Add',
      issue: 'Issue',
      score: 'Score',
      reasons: 'Reasons',
      updated: 'Updated',
      loading: 'Loading...',
      emptyState: 'No watched repos yet - add one above to get started.',
      noIssues: 'No open issues match this repo\\'s label filter.',
      footer: 'contrib-radar - verifies real availability and maintainer sentiment, not just labels.',
      lastRefreshedNever: 'never refreshed',
      lastRefreshedAt: function (rel) { return 'refreshed ' + rel; },
      cooldownActive: function (rel) { return 'cooldown active - showing snapshot from ' + rel; },
    },
    es: {
      selectRepo: 'Selecciona un repo observado',
      addRepo: '+ Agregar repo',
      refresh: 'Actualizar',
      owner: 'Owner',
      repoName: 'Nombre del repo',
      labels: 'Labels (separadas por coma)',
      add: 'Agregar',
      issue: 'Issue',
      score: 'Score',
      reasons: 'Razones',
      updated: 'Actualizado',
      loading: 'Cargando...',
      emptyState: 'Todavía no hay repos observados - agrega uno arriba para empezar.',
      noIssues: 'Ningún issue abierto coincide con el filtro de labels de este repo.',
      footer: 'contrib-radar - verifica disponibilidad real y el sentimiento del mantenedor, no solo etiquetas.',
      lastRefreshedNever: 'nunca actualizado',
      lastRefreshedAt: function (rel) { return 'actualizado ' + rel; },
      cooldownActive: function (rel) { return 'cooldown activo - mostrando foto de ' + rel; },
    },
  };

  const REASON_TEXT = {
    en: {
      ASSIGNEE_ACTIVE: function (p) { return 'Assigned to ' + p.assignees.join(', ') + ' (active, ' + p.daysSinceUpdate + 'd ago)'; },
      ASSIGNEE_STALE: function (p) { return 'Assigned to ' + p.assignees.join(', ') + ' but stale (' + p.daysSinceUpdate + 'd since last update)'; },
      OPEN_COMPETING_PRS: function (p) { return p.count + ' open PR(s) already referencing this issue'; },
      ABANDONED_ATTEMPTS: function (p) { return p.count + ' abandoned attempt(s) (closed without merging)'; },
      RESOLVED_BY_MERGED_PR: function () { return 'A merged PR already references this issue - likely resolved'; },
      STALE_ISSUE: function (p) { return 'No activity in ' + p.daysSinceUpdate + ' days'; },
      BLOCKING_LABEL: function (p) { return 'Blocking label(s): ' + p.labels.join(', '); },
      SENTIMENT_ENCOURAGED: function (p) { return 'Maintainer signal: encouraged - ' + p.rationale; },
      SENTIMENT_NEUTRAL: function (p) { return 'Maintainer signal: neutral - ' + p.rationale; },
      SENTIMENT_DISCOURAGED: function (p) { return 'Maintainer signal: discouraged - ' + p.rationale; },
      SENTIMENT_STALE_OR_DUPLICATE: function (p) { return 'Maintainer signal: stale/duplicate - ' + p.rationale; },
      SENTIMENT_UNAVAILABLE: function () { return 'No maintainer sentiment available (no maintainer comments, or the classifier failed)'; },
    },
    es: {
      ASSIGNEE_ACTIVE: function (p) { return 'Asignado a ' + p.assignees.join(', ') + ' (activo, hace ' + p.daysSinceUpdate + 'd)'; },
      ASSIGNEE_STALE: function (p) { return 'Asignado a ' + p.assignees.join(', ') + ' pero obsoleto (' + p.daysSinceUpdate + 'd sin actualizar)'; },
      OPEN_COMPETING_PRS: function (p) { return p.count + ' PR(s) abiertos ya referencian este issue'; },
      ABANDONED_ATTEMPTS: function (p) { return p.count + ' intento(s) abandonado(s) (cerrados sin mergear)'; },
      RESOLVED_BY_MERGED_PR: function () { return 'Un PR ya mergeado referencia este issue - probablemente resuelto'; },
      STALE_ISSUE: function (p) { return 'Sin actividad hace ' + p.daysSinceUpdate + ' días'; },
      BLOCKING_LABEL: function (p) { return 'Label(s) bloqueante(s): ' + p.labels.join(', '); },
      SENTIMENT_ENCOURAGED: function (p) { return 'Señal del mantenedor: alentado - ' + p.rationale; },
      SENTIMENT_NEUTRAL: function (p) { return 'Señal del mantenedor: neutral - ' + p.rationale; },
      SENTIMENT_DISCOURAGED: function (p) { return 'Señal del mantenedor: desalentado - ' + p.rationale; },
      SENTIMENT_STALE_OR_DUPLICATE: function (p) { return 'Señal del mantenedor: obsoleto/duplicado - ' + p.rationale; },
      SENTIMENT_UNAVAILABLE: function () { return 'Sin señal de sentimiento (sin comentarios de mantenedor, o falló el clasificador)'; },
    },
  };

  const SEVERITY_ICON = { positive: '\\u2713', info: '\\u2139', warning: '\\u26A0', negative: '\\u2717' };

  let lang = 'en';
  let repos = [];
  let selectedRepoId = null;
  let issues = [];
  let sortKey = 'score';
  let sortDir = 'desc';

  const el = {
    repoSelect: document.getElementById('repoSelect'),
    addRepoToggle: document.getElementById('addRepoToggle'),
    addRepoForm: document.getElementById('addRepoForm'),
    addRepoSubmit: document.getElementById('addRepoSubmit'),
    repoOwner: document.getElementById('repoOwner'),
    repoName: document.getElementById('repoName'),
    repoLabels: document.getElementById('repoLabels'),
    refreshBtn: document.getElementById('refreshBtn'),
    lastRefreshed: document.getElementById('lastRefreshed'),
    langToggle: document.getElementById('langToggle'),
    loadingState: document.getElementById('loadingState'),
    emptyState: document.getElementById('emptyState'),
    tableWrap: document.getElementById('tableWrap'),
    issuesBody: document.getElementById('issuesBody'),
  };

  function t(key) { return I18N[lang][key]; }

  function applyI18n() {
    document.querySelectorAll('[data-i18n]').forEach(function (node) {
      const key = node.getAttribute('data-i18n');
      const value = t(key);
      if (typeof value === 'string') { node.textContent = value; }
    });
    el.repoSelect.querySelector('option[value=""]') &&
      (el.repoSelect.querySelector('option[value=""]').textContent = t('selectRepo'));
    renderLastRefreshed();
    if (selectedRepoId) { renderIssues(); } else { renderEmptyOrLoading(); }
  }

  function relativeTime(iso) {
    if (!iso) return null;
    const diffMs = Date.now() - new Date(iso).getTime();
    const mins = Math.round(diffMs / 60000);
    if (mins < 1) return lang === 'es' ? 'hace un momento' : 'just now';
    if (mins < 60) return (lang === 'es' ? 'hace ' + mins + 'min' : mins + 'min ago');
    const hours = Math.round(mins / 60);
    if (hours < 24) return (lang === 'es' ? 'hace ' + hours + 'h' : hours + 'h ago');
    const days = Math.round(hours / 24);
    return (lang === 'es' ? 'hace ' + days + 'd' : days + 'd ago');
  }

  async function api(path, options) {
    const res = await fetch(path, Object.assign({ headers: { 'Content-Type': 'application/json' } }, options));
    if (!res.ok) { throw new Error('request to ' + path + ' failed (' + res.status + ')'); }
    if (res.status === 204) return null;
    return res.json();
  }

  function currentRepo() { return repos.find(function (r) { return r.id === selectedRepoId; }); }

  function renderLastRefreshed() {
    const repo = currentRepo();
    if (!repo) { el.lastRefreshed.textContent = ''; return; }
    el.lastRefreshed.textContent = repo.lastRefreshedAt
      ? t('lastRefreshedAt')(relativeTime(repo.lastRefreshedAt))
      : t('lastRefreshedNever');
  }

  function renderRepoOptions() {
    el.repoSelect.innerHTML = '';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = t('selectRepo');
    el.repoSelect.appendChild(placeholder);
    repos.forEach(function (r) {
      const opt = document.createElement('option');
      opt.value = r.id;
      opt.textContent = r.owner + '/' + r.name;
      el.repoSelect.appendChild(opt);
    });
    el.repoSelect.value = selectedRepoId || '';
  }

  function renderEmptyOrLoading() {
    el.loadingState.style.display = 'none';
    if (repos.length === 0) {
      el.emptyState.style.display = 'block';
      el.tableWrap.style.display = 'none';
    } else {
      el.emptyState.style.display = 'none';
    }
  }

  function scoreClass(score) {
    if (score >= 70) return 'score-high';
    if (score >= 40) return 'score-mid';
    return 'score-low';
  }

  function sortedIssues() {
    const copy = issues.slice();
    copy.sort(function (a, b) {
      let av = a[sortKey], bv = b[sortKey];
      if (sortKey === 'githubUpdatedAt') { av = new Date(av).getTime(); bv = new Date(bv).getTime(); }
      if (typeof av === 'string') { av = av.toLowerCase(); bv = bv.toLowerCase(); }
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return copy;
  }

  function renderIssues() {
    el.loadingState.style.display = 'none';
    el.emptyState.style.display = 'none';

    if (issues.length === 0) {
      el.tableWrap.style.display = 'none';
      el.emptyState.style.display = 'block';
      el.emptyState.textContent = t('noIssues');
      return;
    }

    el.tableWrap.style.display = 'block';
    el.issuesBody.innerHTML = '';

    sortedIssues().forEach(function (issue) {
      const tr = document.createElement('tr');

      const titleTd = document.createElement('td');
      const link = document.createElement('a');
      link.href = issue.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.className = 'issue-title';
      link.textContent = issue.title;
      const numberSpan = document.createElement('span');
      numberSpan.className = 'issue-number';
      numberSpan.textContent = ' #' + issue.issueNumber;
      titleTd.appendChild(link);
      titleTd.appendChild(numberSpan);
      tr.appendChild(titleTd);

      const scoreTd = document.createElement('td');
      const badge = document.createElement('span');
      badge.className = 'score-badge ' + scoreClass(issue.score);
      badge.textContent = issue.score;
      scoreTd.appendChild(badge);
      tr.appendChild(scoreTd);

      const reasonsTd = document.createElement('td');
      const reasonsWrap = document.createElement('div');
      reasonsWrap.className = 'reasons';
      (issue.reasons || []).forEach(function (reason) {
        const icon = document.createElement('span');
        icon.className = 'reason-icon reason-' + reason.severity;
        icon.textContent = SEVERITY_ICON[reason.severity] || '?';
        const describe = REASON_TEXT[lang][reason.code];
        icon.title = describe ? describe(reason.params || {}) : reason.code;
        reasonsWrap.appendChild(icon);
      });
      reasonsTd.appendChild(reasonsWrap);
      tr.appendChild(reasonsTd);

      const updatedTd = document.createElement('td');
      updatedTd.className = 'updated-cell';
      updatedTd.textContent = relativeTime(issue.githubUpdatedAt);
      tr.appendChild(updatedTd);

      el.issuesBody.appendChild(tr);
    });
  }

  function updateSortArrows() {
    document.querySelectorAll('th[data-sort]').forEach(function (th) {
      const existing = th.querySelector('.sort-arrow');
      if (existing) existing.remove();
      if (th.getAttribute('data-sort') === sortKey) {
        const arrow = document.createElement('span');
        arrow.className = 'sort-arrow';
        arrow.textContent = sortDir === 'asc' ? '\\u2191' : '\\u2193';
        th.appendChild(arrow);
      }
    });
  }

  async function loadRepos(selectId) {
    repos = await api('/repos');
    selectedRepoId = selectId || (repos[0] && repos[0].id) || null;
    renderRepoOptions();
    renderLastRefreshed();
    if (selectedRepoId) {
      await loadIssues();
    } else {
      renderEmptyOrLoading();
    }
  }

  async function loadIssues() {
    if (!selectedRepoId) return;
    issues = await api('/repos/' + selectedRepoId + '/issues');
    renderIssues();
  }

  el.repoSelect.addEventListener('change', function () {
    selectedRepoId = el.repoSelect.value || null;
    renderLastRefreshed();
    if (selectedRepoId) { loadIssues(); } else { issues = []; renderEmptyOrLoading(); }
  });

  el.addRepoToggle.addEventListener('click', function () {
    el.addRepoForm.classList.toggle('open');
  });

  el.addRepoSubmit.addEventListener('click', async function () {
    const owner = el.repoOwner.value.trim();
    const name = el.repoName.value.trim();
    if (!owner || !name) return;
    const labelFilter = el.repoLabels.value.trim()
      ? el.repoLabels.value.split(',').map(function (s) { return s.trim(); }).filter(Boolean)
      : undefined;
    const body = { owner: owner, name: name };
    if (labelFilter) body.labelFilter = labelFilter;
    const created = await api('/repos', { method: 'POST', body: JSON.stringify(body) });
    el.repoOwner.value = '';
    el.repoName.value = '';
    el.repoLabels.value = '';
    el.addRepoForm.classList.remove('open');
    await loadRepos(created.id);
  });

  el.refreshBtn.addEventListener('click', async function () {
    if (!selectedRepoId) return;
    el.refreshBtn.classList.add('loading');
    el.refreshBtn.disabled = true;
    try {
      await api('/repos/' + selectedRepoId + '/refresh', { method: 'POST' });
      repos = await api('/repos');
      renderRepoOptions();
      renderLastRefreshed();
      await loadIssues();
    } finally {
      el.refreshBtn.classList.remove('loading');
      el.refreshBtn.disabled = false;
    }
  });

  document.querySelectorAll('th[data-sort]').forEach(function (th) {
    th.addEventListener('click', function () {
      const key = th.getAttribute('data-sort');
      if (sortKey === key) {
        sortDir = sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        sortKey = key;
        sortDir = key === 'title' ? 'asc' : 'desc';
      }
      updateSortArrows();
      renderIssues();
    });
  });

  el.langToggle.addEventListener('click', function () {
    lang = lang === 'en' ? 'es' : 'en';
    el.langToggle.textContent = lang === 'en' ? 'ES' : 'EN';
    applyI18n();
  });

  updateSortArrows();
  loadRepos().catch(function (err) {
    el.loadingState.textContent = String(err);
  });
})();
</script>
</body>
</html>
`;
