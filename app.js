const DB_NAME = 'liftglass-pro-db';
const DB_VERSION = 1;
const STORE_NAME = 'app-state';
const STATE_KEY = 'state-v1';

const state = {
  exercises: [],
  templates: [],
  sessions: [],
  recentExerciseIds: [],
  ui: { theme: 'system', activeView: 'plan' },
  activeSession: null,
};

const el = {};
let restInterval = null;
let restRemaining = 0;

function uid(prefix = 'id') {
  return `${prefix}-${crypto.randomUUID()}`;
}

function sanitizeText(input, maxLength = 200) {
  if (typeof input !== 'string') return '';
  return input
    .replace(/[<>`]/g, '')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .trim()
    .slice(0, maxLength);
}

function clamp(num, min, max) {
  return Math.max(min, Math.min(max, num));
}

function parseRepRange(text) {
  const match = /^\s*(\d{1,2})\s*-\s*(\d{1,2})\s*$/.exec(String(text || ''));
  if (!match) return { min: 8, max: 12 };
  const min = clamp(Number(match[1]), 1, 30);
  const max = clamp(Number(match[2]), min, 40);
  return { min, max };
}

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function loadState() {
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, 'readonly');
  const store = tx.objectStore(STORE_NAME);
  const data = await new Promise((resolve, reject) => {
    const req = store.get(STATE_KEY);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  db.close();
  if (data && validateImportShape(data)) {
    Object.assign(state, data);
  }
}

async function saveState() {
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  tx.objectStore(STORE_NAME).put(
    {
      exercises: state.exercises,
      templates: state.templates,
      sessions: state.sessions,
      recentExerciseIds: state.recentExerciseIds,
      ui: state.ui,
      activeSession: state.activeSession,
    },
    STATE_KEY,
  );
  await new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
  db.close();
}

function toast(text) {
  el.toast.textContent = text;
  el.toast.classList.add('show');
  window.setTimeout(() => el.toast.classList.remove('show'), 1600);
}

function createNode(tag, attrs = {}, text = '') {
  const node = document.createElement(tag);
  Object.entries(attrs).forEach(([key, value]) => {
    if (key === 'class') node.className = value;
    else node.setAttribute(key, String(value));
  });
  if (text) node.textContent = text;
  return node;
}

function setTheme(theme) {
  state.ui.theme = theme;
  document.body.classList.remove('manual-light', 'manual-dark');
  if (theme === 'light') document.body.classList.add('manual-light');
  if (theme === 'dark') document.body.classList.add('manual-dark');
  saveState().catch(() => undefined);
}

function switchView(next) {
  state.ui.activeView = next;
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${next}`));
  document.querySelectorAll('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.view === next));
  saveState().catch(() => undefined);
}

function renderExercises() {
  const query = sanitizeText(el.exerciseSearch.value.toLowerCase(), 80);
  const filtered = state.exercises.filter((exercise) => {
    const blob = `${exercise.name} ${exercise.muscleGroup} ${exercise.equipment}`.toLowerCase();
    return blob.includes(query);
  });

  el.exerciseList.replaceChildren();
  filtered.forEach((exercise) => {
    const item = createNode('article', { class: 'list-item' });
    item.append(
      createNode('strong', {}, exercise.name),
      createNode('span', { class: 'muted' }, `${exercise.muscleGroup} · ${exercise.movementPattern} · ${exercise.equipment}`),
      createNode('span', { class: 'muted' }, `${exercise.unilateral ? 'Unilateral' : 'Bilateral'} · ${exercise.warmupNeeded ? 'Warm-up needed' : 'No warm-up'}`),
    );
    const row = createNode('div', { class: 'row wrap' });
    const favBtn = createNode('button', { type: 'button', class: 'chip' }, exercise.favorite ? '★ Favorite' : '☆ Favorite');
    favBtn.addEventListener('click', async () => {
      exercise.favorite = !exercise.favorite;
      await saveState();
      renderAll();
    });
    row.append(favBtn);
    item.append(row);
    el.exerciseList.append(item);
  });
}

function renderTemplateSelectors() {
  const selectors = [el.templateSelect, el.logTemplateSelect];
  selectors.forEach((sel) => {
    sel.replaceChildren();
    state.templates.forEach((template) => {
      const opt = createNode('option', { value: template.id }, template.name);
      sel.append(opt);
    });
  });

  if (!state.templates.length) {
    [el.daySelect, el.logDaySelect, el.templateExerciseSelect].forEach((n) => n.replaceChildren());
    el.templateDayExercises.replaceChildren();
    return;
  }

  const selectedTemplateId = el.templateSelect.value || state.templates[0].id;
  el.templateSelect.value = selectedTemplateId;
  const logSelectedTemplateId = el.logTemplateSelect.value || selectedTemplateId;
  el.logTemplateSelect.value = logSelectedTemplateId;
  renderDaySelectors();
}

function renderDaySelectors() {
  const template = state.templates.find((t) => t.id === el.templateSelect.value) || state.templates[0];
  const logTemplate = state.templates.find((t) => t.id === el.logTemplateSelect.value) || template;

  el.daySelect.replaceChildren();
  (template?.days || []).forEach((day) => {
    el.daySelect.append(createNode('option', { value: day.id }, day.name));
  });

  el.logDaySelect.replaceChildren();
  (logTemplate?.days || []).forEach((day) => {
    el.logDaySelect.append(createNode('option', { value: day.id }, day.name));
  });

  el.templateExerciseSelect.replaceChildren();
  state.exercises.forEach((exercise) => {
    el.templateExerciseSelect.append(createNode('option', { value: exercise.id }, exercise.name));
  });

  renderTemplateDayExercises();
}

function renderTemplateDayExercises() {
  const template = state.templates.find((t) => t.id === el.templateSelect.value);
  const day = template?.days.find((d) => d.id === el.daySelect.value) || template?.days[0];
  el.templateDayExercises.replaceChildren();
  if (!day) return;

  day.exercises.forEach((entry, index) => {
    const ex = state.exercises.find((e) => e.id === entry.exerciseId);
    const card = createNode('div', { class: 'list-item' });
    card.append(
      createNode('strong', {}, ex?.name || 'Deleted exercise'),
      createNode('span', { class: 'muted' }, `${entry.sets} sets · ${entry.repRange} reps · ${entry.rest}s rest · tempo ${entry.tempo}`),
      createNode('span', { class: 'muted' }, `Target RPE ${entry.targetRpe} / RIR ${entry.targetRir}`),
    );

    const remove = createNode('button', { type: 'button', class: 'chip' }, 'Remove');
    remove.addEventListener('click', async () => {
      day.exercises.splice(index, 1);
      await saveState();
      renderAll();
    });
    card.append(remove);
    el.templateDayExercises.append(card);
  });
}

function updateRecentExercises(exerciseId) {
  state.recentExerciseIds = [exerciseId, ...state.recentExerciseIds.filter((id) => id !== exerciseId)].slice(0, 8);
}

function getLastExerciseSets(exerciseId) {
  const withExercise = state.sessions
    .slice()
    .reverse()
    .map((session) => session.exercises.find((entry) => entry.exerciseId === exerciseId))
    .filter(Boolean);
  return withExercise[0]?.sets || [];
}

function suggestNextTarget(entry) {
  const sets = entry.sets.filter((s) => s.completed);
  if (!sets.length) return { title: 'No data yet', rationale: 'Complete at least one set to receive suggestions.' };

  const { min, max } = parseRepRange(entry.target.repRange);
  const targetRpe = Number(entry.target.targetRpe || 8);
  const avgRpe = sets.reduce((acc, set) => acc + Number(set.rpe || targetRpe), 0) / sets.length;
  const allAtTop = sets.every((set) => Number(set.reps || 0) >= max);
  const lowRepCount = sets.filter((set) => Number(set.reps || 0) < min).length;
  const avgWeight = sets.reduce((acc, set) => acc + Number(set.weight || 0), 0) / sets.length;
  const roundedBase = Math.max(0, Math.round(avgWeight * 2) / 2);

  if (allAtTop && avgRpe <= targetRpe) {
    const next = Math.round(Math.max(roundedBase + 0.5, roundedBase * 1.025) * 2) / 2;
    return {
      title: `Increase load to ~${next.toFixed(1)} kg`,
      rationale: `All sets reached the top of ${max} reps at avg RPE ${avgRpe.toFixed(1)} (≤ target ${targetRpe}).`,
    };
  }

  if (lowRepCount >= Math.ceil(sets.length / 2) || avgRpe > targetRpe + 0.75) {
    const next = Math.max(0, Math.round(roundedBase * 0.975 * 2) / 2);
    return {
      title: next >= roundedBase ? `Hold at ${roundedBase.toFixed(1)} kg` : `Reduce to ~${next.toFixed(1)} kg`,
      rationale: `Reps dropped below ${min} on ${lowRepCount}/${sets.length} sets or avg RPE ${avgRpe.toFixed(1)} exceeded target.`,
    };
  }

  return {
    title: `Hold load and add reps (${min}-${max})`,
    rationale: `Performance is in-range at avg RPE ${avgRpe.toFixed(1)}. Progress with rep quality before increasing load.`,
  };
}

function estimateOneRm(weight, reps) {
  const w = Number(weight || 0);
  const r = Number(reps || 0);
  if (!w || !r) return 0;
  return w * (1 + r / 30);
}

function renderSessionPanel() {
  const session = state.activeSession;
  if (!session) {
    el.sessionPanel.classList.add('hidden');
    el.sessionStatus.textContent = 'No active session';
    return;
  }

  const current = session.exercises[session.currentExerciseIndex] || session.exercises[0];
  const exerciseMeta = state.exercises.find((e) => e.id === current.exerciseId);
  const suggestion = suggestNextTarget(current);

  el.sessionPanel.classList.remove('hidden');
  el.sessionStatus.textContent = `Session started ${new Date(session.startedAt).toLocaleTimeString()} · ${session.exercises.length} exercises`;
  el.sessionPanel.replaceChildren();

  const title = createNode('h3', {}, `${session.currentExerciseIndex + 1}/${session.exercises.length} · ${exerciseMeta?.name || current.exerciseName}`);
  const subtitle = createNode('p', { class: 'muted' }, `${current.target.sets} sets · ${current.target.repRange} reps · Target RPE ${current.target.targetRpe}`);
  const suggestionCard = createNode('div', { class: 'list-item' });
  suggestionCard.append(createNode('strong', {}, suggestion.title), createNode('span', { class: 'muted' }, suggestion.rationale));

  const table = createNode('div', { class: 'table-like' });
  const history = current.sets;
  history.forEach((set, idx) => {
    const row = createNode('div', { class: 'set-row list-item' });
    row.append(
      createNode('span', {}, `${idx + 1}`),
      createNode('span', {}, `${Number(set.weight || 0).toFixed(1)}kg × ${set.reps}`),
      createNode('span', {}, `RPE ${set.rpe || '-'} / RIR ${set.rir || '-'}`),
      createNode('span', { class: 'desktop-only muted' }, set.note || ''),
    );
    table.append(row);
  });

  const draft = current.draft || { weight: 0, reps: parseRepRange(current.target.repRange).min, rpe: current.target.targetRpe, rir: current.target.targetRir, note: '' };
  current.draft = draft;

  const controls = createNode('div', { class: 'stack' });
  const metricRow = createNode('div', { class: 'row wrap' });
  const weightDown = createNode('button', { type: 'button', class: 'chip-btn' }, '− Weight');
  const weightUp = createNode('button', { type: 'button', class: 'chip-btn' }, '+ Weight');
  const repsDown = createNode('button', { type: 'button', class: 'chip-btn' }, '− Reps');
  const repsUp = createNode('button', { type: 'button', class: 'chip-btn' }, '+ Reps');
  const dupLast = createNode('button', { type: 'button', class: 'chip-btn' }, 'Duplicate last');
  metricRow.append(weightDown, weightUp, repsDown, repsUp, dupLast);

  const fields = createNode('div', { class: 'grid-2' });
  const weightInput = createNode('input', { type: 'number', step: '0.5', min: '0', value: String(draft.weight || 0), 'aria-label': 'Weight' });
  const repsInput = createNode('input', { type: 'number', min: '1', max: '50', value: String(draft.reps || 8), 'aria-label': 'Reps' });
  const rpeInput = createNode('input', { type: 'number', min: '4', max: '10', step: '0.5', value: String(draft.rpe || 8), 'aria-label': 'RPE' });
  const rirInput = createNode('input', { type: 'number', min: '0', max: '6', value: String(draft.rir || 2), 'aria-label': 'RIR' });
  const noteInput = createNode('input', { maxlength: '200', value: String(draft.note || ''), placeholder: 'Set note (optional)', 'aria-label': 'Note' });
  fields.append(weightInput, repsInput, rpeInput, rirInput, noteInput);

  const timer = createNode('div', { class: 'timer', id: 'timer-display' }, restRemaining ? `Rest ${restRemaining}s` : 'Rest timer idle');
  const buttonRow = createNode('div', { class: 'row wrap' });
  const addSetBtn = createNode('button', { type: 'button', class: 'primary' }, 'Log set');
  const nextExerciseBtn = createNode('button', { type: 'button', class: 'chip' }, 'Next exercise');
  const finishBtn = createNode('button', { type: 'button', class: 'chip' }, 'Finish session');
  buttonRow.append(addSetBtn, nextExerciseBtn, finishBtn);

  function syncDraft() {
    current.draft = {
      weight: clamp(Number(weightInput.value || 0), 0, 1000),
      reps: clamp(Number(repsInput.value || 0), 1, 99),
      rpe: clamp(Number(rpeInput.value || 0), 4, 10),
      rir: clamp(Number(rirInput.value || 0), 0, 6),
      note: sanitizeText(noteInput.value, 200),
    };
  }

  [weightInput, repsInput, rpeInput, rirInput, noteInput].forEach((field) => {
    field.addEventListener('input', async () => {
      syncDraft();
      await saveState();
    });
  });

  const applyDelta = (field, delta) => {
    syncDraft();
    current.draft[field] = clamp(Number(current.draft[field] || 0) + delta, field === 'weight' ? 0 : 1, field === 'weight' ? 1000 : 99);
    if (field === 'weight') current.draft.weight = Math.round(current.draft.weight * 2) / 2;
    weightInput.value = String(current.draft.weight);
    repsInput.value = String(current.draft.reps);
    saveState().catch(() => undefined);
  };

  weightDown.addEventListener('click', () => applyDelta('weight', -0.5));
  weightUp.addEventListener('click', () => applyDelta('weight', 0.5));
  repsDown.addEventListener('click', () => applyDelta('reps', -1));
  repsUp.addEventListener('click', () => applyDelta('reps', 1));

  dupLast.addEventListener('click', () => {
    const last = current.sets[current.sets.length - 1] || getLastExerciseSets(current.exerciseId).slice(-1)[0];
    if (!last) return;
    current.draft = { weight: Number(last.weight || 0), reps: Number(last.reps || 0), rpe: Number(last.rpe || current.target.targetRpe), rir: Number(last.rir || current.target.targetRir), note: sanitizeText(last.note || '', 200) };
    weightInput.value = String(current.draft.weight);
    repsInput.value = String(current.draft.reps);
    rpeInput.value = String(current.draft.rpe);
    rirInput.value = String(current.draft.rir);
    noteInput.value = current.draft.note;
    saveState().catch(() => undefined);
  });

  function startRest(seconds) {
    window.clearInterval(restInterval);
    restRemaining = seconds;
    timer.textContent = `Rest ${restRemaining}s`;
    restInterval = window.setInterval(() => {
      restRemaining -= 1;
      timer.textContent = restRemaining > 0 ? `Rest ${restRemaining}s` : 'Rest complete';
      if (restRemaining <= 0) {
        window.clearInterval(restInterval);
        if ('vibrate' in navigator) navigator.vibrate([80, 60, 120]);
      }
    }, 1000);
  }

  addSetBtn.addEventListener('click', async () => {
    syncDraft();
    const newSet = {
      weight: current.draft.weight,
      reps: current.draft.reps,
      rpe: current.draft.rpe,
      rir: current.draft.rir,
      note: current.draft.note,
      completed: true,
      loggedAt: new Date().toISOString(),
    };
    current.sets.push(newSet);
    updateRecentExercises(current.exerciseId);
    const setCountTarget = Number(current.target.sets || 3);
    if (current.sets.length >= setCountTarget) {
      toast('Set target completed. Move to next exercise when ready.');
    }
    startRest(Number(current.target.rest || 90));
    await saveState();
    renderAll();
  });

  nextExerciseBtn.addEventListener('click', async () => {
    session.currentExerciseIndex = Math.min(session.currentExerciseIndex + 1, session.exercises.length - 1);
    await saveState();
    renderAll();
  });

  finishBtn.addEventListener('click', async () => {
    session.completedAt = new Date().toISOString();
    state.sessions.push({
      id: session.id,
      templateId: session.templateId,
      dayId: session.dayId,
      startedAt: session.startedAt,
      completedAt: session.completedAt,
      exercises: session.exercises.map((entry) => ({
        exerciseId: entry.exerciseId,
        exerciseName: entry.exerciseName,
        target: entry.target,
        sets: entry.sets,
      })),
    });
    state.activeSession = null;
    await saveState();
    toast('Session saved. Great work.');
    renderAll();
  });

  controls.append(metricRow, fields, timer, buttonRow);
  el.sessionPanel.append(title, subtitle, suggestionCard, table, controls);
}

function renderRecentExercises() {
  el.recentExercises.replaceChildren();
  const ids = state.recentExerciseIds.slice(0, 6);
  if (!ids.length) {
    el.recentExercises.append(createNode('span', { class: 'muted' }, 'Recent exercises will appear here.'));
    return;
  }
  ids.forEach((id) => {
    const exercise = state.exercises.find((ex) => ex.id === id);
    if (!exercise) return;
    const button = createNode('button', { class: 'chip-btn', type: 'button' }, exercise.name);
    button.addEventListener('click', () => {
      const session = state.activeSession;
      if (!session) return;
      const idx = session.exercises.findIndex((entry) => entry.exerciseId === exercise.id);
      if (idx >= 0) {
        session.currentExerciseIndex = idx;
        saveState().then(renderAll);
      }
    });
    el.recentExercises.append(button);
  });
}

function drawLineChart(canvas, points, label) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = 'rgba(112, 149, 214, 0.2)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = '#70a2ff';
  ctx.lineWidth = 2;

  if (points.length < 2) {
    ctx.fillStyle = '#2d4469';
    ctx.font = '14px sans-serif';
    ctx.fillText(`No trend yet for ${label}`, 12, 24);
    return;
  }

  const min = Math.min(...points.map((p) => p.value));
  const max = Math.max(...points.map((p) => p.value));
  const spread = max - min || 1;

  ctx.beginPath();
  points.forEach((point, index) => {
    const x = (index / (points.length - 1)) * (canvas.width - 24) + 12;
    const y = canvas.height - (((point.value - min) / spread) * (canvas.height - 30) + 12);
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  ctx.fillStyle = '#1e2d49';
  ctx.font = '12px sans-serif';
  ctx.fillText(`${label} min ${min.toFixed(1)} · max ${max.toFixed(1)}`, 12, canvas.height - 8);
}

function renderAnalytics() {
  el.analyticsExerciseSelect.replaceChildren();
  state.exercises.forEach((exercise) => {
    el.analyticsExerciseSelect.append(createNode('option', { value: exercise.id }, exercise.name));
  });

  const selected = state.exercises.find((ex) => ex.id === el.analyticsExerciseSelect.value) || state.exercises[0];
  if (!selected) {
    el.analyticsSummary.replaceChildren(createNode('p', { class: 'muted' }, 'Log sessions to unlock analytics.'));
    el.prList.replaceChildren();
    drawLineChart(el.historyChart, [], 'Load');
    drawLineChart(el.oneRmChart, [], 'e1RM');
    return;
  }
  el.analyticsExerciseSelect.value = selected.id;

  const sets = [];
  state.sessions.forEach((session) => {
    const entry = session.exercises.find((ex) => ex.exerciseId === selected.id);
    if (entry) {
      entry.sets.forEach((set) => {
        sets.push({ date: new Date(set.loggedAt || session.completedAt || session.startedAt), weight: Number(set.weight || 0), reps: Number(set.reps || 0), e1rm: estimateOneRm(set.weight, set.reps) });
      });
    }
  });
  sets.sort((a, b) => a.date - b.date);
  drawLineChart(el.historyChart, sets.map((s) => ({ value: s.weight })), 'Load');
  drawLineChart(el.oneRmChart, sets.map((s) => ({ value: s.e1rm })), 'e1RM');

  const volumeByWeekAndMuscle = {};
  const consistency = { total: 0, completed: 0 };
  state.sessions.forEach((session) => {
    consistency.total += 1;
    if (session.completedAt) consistency.completed += 1;
    session.exercises.forEach((entry) => {
      const exercise = state.exercises.find((e) => e.id === entry.exerciseId);
      const muscle = exercise?.muscleGroup || 'Other';
      entry.sets.forEach((set) => {
        const date = new Date(set.loggedAt || session.completedAt || session.startedAt);
        const week = `${date.getUTCFullYear()}-W${String(Math.ceil((date.getUTCDate() + 6) / 7)).padStart(2, '0')}`;
        const key = `${week}|${muscle}`;
        volumeByWeekAndMuscle[key] = (volumeByWeekAndMuscle[key] || 0) + Number(set.weight || 0) * Number(set.reps || 0);
      });
    });
  });

  const muscles = Object.entries(volumeByWeekAndMuscle)
    .slice(-8)
    .map(([k, vol]) => `${k.replace('|', ' · ')}: ${Math.round(vol)} kg·reps`);

  let streak = 0;
  const weeklyCompleted = new Set(
    state.sessions
      .filter((s) => s.completedAt)
      .map((s) => {
        const d = new Date(s.completedAt);
        return `${d.getUTCFullYear()}-${Math.ceil((d.getUTCDate() + 6) / 7)}`;
      }),
  );
  for (let i = 0; i < 20; i += 1) {
    const dt = new Date();
    dt.setUTCDate(dt.getUTCDate() - i * 7);
    const key = `${dt.getUTCFullYear()}-${Math.ceil((dt.getUTCDate() + 6) / 7)}`;
    if (weeklyCompleted.has(key)) streak += 1;
    else break;
  }

  const bestByExercise = {};
  state.sessions.forEach((session) => {
    session.exercises.forEach((entry) => {
      entry.sets.forEach((set) => {
        const e1rm = estimateOneRm(set.weight, set.reps);
        const current = bestByExercise[entry.exerciseId] || { e1rm: 0, heavy: 0 };
        bestByExercise[entry.exerciseId] = {
          e1rm: Math.max(current.e1rm, e1rm),
          heavy: Math.max(current.heavy, Number(set.weight || 0)),
        };
      });
    });
  });

  const selectedRecent = sets.slice(-4).map((set) => set.e1rm);
  const plateau = selectedRecent.length >= 4 && Math.max(...selectedRecent) - Math.min(...selectedRecent) < 1;

  el.analyticsSummary.replaceChildren(
    createNode('p', {}, `Completion consistency: ${consistency.total ? Math.round((consistency.completed / consistency.total) * 100) : 0}%`),
    createNode('p', {}, `Current training streak: ${streak} week${streak === 1 ? '' : 's'}`),
    createNode('p', {}, `Plateau check (${selected.name}): ${plateau ? 'Potential plateau — consider deload or variation.' : 'Progressing or too little data.'}`),
    createNode('p', { class: 'muted' }, muscles.join(' | ') || 'Volume per muscle will appear after logging workouts.'),
  );

  el.prList.replaceChildren();
  Object.entries(bestByExercise)
    .sort((a, b) => b[1].e1rm - a[1].e1rm)
    .forEach(([exerciseId, record]) => {
      const exercise = state.exercises.find((ex) => ex.id === exerciseId);
      const item = createNode('div', { class: 'list-item' });
      item.append(
        createNode('strong', {}, exercise?.name || exerciseId),
        createNode('span', { class: 'muted' }, `Best e1RM: ${record.e1rm.toFixed(1)} kg`),
        createNode('span', { class: 'muted' }, `Heaviest set: ${record.heavy.toFixed(1)} kg`),
      );
      el.prList.append(item);
    });
}

function renderAll() {
  renderExercises();
  renderTemplateSelectors();
  renderRecentExercises();
  renderSessionPanel();
  renderAnalytics();
}

function validateImportShape(parsed) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
  const arrayProps = ['exercises', 'templates', 'sessions', 'recentExerciseIds'];
  if (arrayProps.some((k) => !Array.isArray(parsed[k]))) return false;
  if (typeof parsed.ui !== 'object' || parsed.ui === null) return false;
  if (parsed.activeSession !== null && typeof parsed.activeSession !== 'object') return false;
  return true;
}

function attachEvents() {
  el.themeToggle.addEventListener('click', () => {
    const next = state.ui.theme === 'dark' ? 'light' : state.ui.theme === 'light' ? 'system' : 'dark';
    setTheme(next);
    toast(`Theme: ${next}`);
  });

  document.querySelectorAll('.nav-btn').forEach((btn) => {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
  });

  el.exerciseSearch.addEventListener('input', renderExercises);

  el.exerciseForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const fd = new FormData(el.exerciseForm);
    const exercise = {
      id: uid('ex'),
      name: sanitizeText(fd.get('name'), 80),
      muscleGroup: sanitizeText(fd.get('muscleGroup'), 40),
      movementPattern: sanitizeText(fd.get('movementPattern'), 40),
      equipment: sanitizeText(fd.get('equipment'), 40),
      unilateral: fd.get('unilateral') === 'on',
      warmupNeeded: fd.get('warmupNeeded') === 'on',
      favorite: false,
      createdAt: new Date().toISOString(),
    };
    if (!exercise.name || !exercise.muscleGroup || !exercise.movementPattern || !exercise.equipment) {
      toast('Please complete all exercise fields.');
      return;
    }
    state.exercises.push(exercise);
    el.exerciseForm.reset();
    await saveState();
    renderAll();
    toast('Exercise saved.');
  });

  el.templateForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const fd = new FormData(el.templateForm);
    const template = {
      id: uid('tpl'),
      name: sanitizeText(fd.get('name'), 60),
      split: sanitizeText(fd.get('split'), 30),
      createdAt: new Date().toISOString(),
      days: [{ id: uid('day'), name: sanitizeText(fd.get('dayName'), 40), exercises: [] }],
    };
    if (!template.name || !template.days[0].name) {
      toast('Template and day names are required.');
      return;
    }
    state.templates.push(template);
    el.templateForm.reset();
    await saveState();
    renderAll();
    toast('Template created.');
  });

  [el.templateSelect, el.logTemplateSelect].forEach((sel) => sel.addEventListener('change', renderDaySelectors));
  [el.daySelect, el.logDaySelect].forEach((sel) => sel.addEventListener('change', renderTemplateDayExercises));

  el.addTemplateExerciseForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const template = state.templates.find((t) => t.id === el.templateSelect.value);
    const day = template?.days.find((d) => d.id === el.daySelect.value) || template?.days[0];
    if (!template || !day) {
      toast('Create a template first.');
      return;
    }
    const fd = new FormData(el.addTemplateExerciseForm);
    const exerciseId = sanitizeText(fd.get('exerciseId') || el.templateExerciseSelect.value, 60);
    const exercise = state.exercises.find((ex) => ex.id === exerciseId);
    if (!exercise) {
      toast('Select a valid exercise.');
      return;
    }
    const repRange = sanitizeText(fd.get('repRange'), 12);
    const parsed = parseRepRange(repRange);
    day.exercises.push({
      exerciseId,
      sets: clamp(Number(fd.get('sets') || 3), 1, 12),
      repRange: `${parsed.min}-${parsed.max}`,
      rest: clamp(Number(fd.get('rest') || 90), 15, 600),
      tempo: sanitizeText(fd.get('tempo'), 16),
      targetRpe: clamp(Number(fd.get('targetRpe') || 8), 4, 10),
      targetRir: clamp(Number(fd.get('targetRir') || 2), 0, 6),
    });
    await saveState();
    renderAll();
    toast('Exercise added to day.');
  });

  el.duplicateDayBtn.addEventListener('click', async () => {
    const template = state.templates.find((t) => t.id === el.templateSelect.value);
    const day = template?.days.find((d) => d.id === el.daySelect.value) || template?.days[0];
    if (!template || !day) return;
    template.days.push({ id: uid('day'), name: `${day.name} copy`, exercises: structuredClone(day.exercises) });
    await saveState();
    renderAll();
    toast('Day duplicated.');
  });

  el.startSession.addEventListener('click', async () => {
    const template = state.templates.find((t) => t.id === el.logTemplateSelect.value);
    const day = template?.days.find((d) => d.id === el.logDaySelect.value) || template?.days[0];
    if (!template || !day || !day.exercises.length) {
      toast('Select a day with exercises before starting.');
      return;
    }

    state.activeSession = {
      id: uid('session'),
      templateId: template.id,
      dayId: day.id,
      startedAt: new Date().toISOString(),
      currentExerciseIndex: 0,
      exercises: day.exercises.map((entry) => {
        const exercise = state.exercises.find((e) => e.id === entry.exerciseId);
        return {
          exerciseId: entry.exerciseId,
          exerciseName: exercise?.name || 'Unknown',
          target: {
            sets: entry.sets,
            repRange: entry.repRange,
            rest: entry.rest,
            tempo: entry.tempo,
            targetRpe: entry.targetRpe,
            targetRir: entry.targetRir,
          },
          sets: [],
        };
      }),
    };
    await saveState();
    switchView('log');
    renderAll();
    toast('Session started.');
  });

  el.analyticsExerciseSelect.addEventListener('change', renderAnalytics);

  el.exportData.addEventListener('click', () => {
    const data = {
      exportedAt: new Date().toISOString(),
      app: 'LiftGlass Pro',
      version: 1,
      ...state,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = createNode('a', { href: url, download: `liftglass-pro-${Date.now()}.json` });
    document.body.append(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast('Export complete.');
  });

  el.importFile.addEventListener('change', async () => {
    const [file] = el.importFile.files || [];
    if (!file) return;
    try {
      if (file.size > 3_000_000) throw new Error('Import file too large.');
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (!validateImportShape(parsed)) throw new Error('JSON schema mismatch.');

      parsed.exercises = parsed.exercises.map((exercise) => ({
        ...exercise,
        id: sanitizeText(exercise.id, 80) || uid('ex'),
        name: sanitizeText(exercise.name, 80),
        muscleGroup: sanitizeText(exercise.muscleGroup, 40),
        movementPattern: sanitizeText(exercise.movementPattern, 40),
        equipment: sanitizeText(exercise.equipment, 40),
      }));
      parsed.templates = parsed.templates.map((template) => ({
        ...template,
        id: sanitizeText(template.id, 80) || uid('tpl'),
        name: sanitizeText(template.name, 60),
        split: sanitizeText(template.split, 30),
        days: Array.isArray(template.days)
          ? template.days.map((day) => ({
              ...day,
              id: sanitizeText(day.id, 80) || uid('day'),
              name: sanitizeText(day.name, 40),
              exercises: Array.isArray(day.exercises)
                ? day.exercises.map((entry) => ({
                    ...entry,
                    exerciseId: sanitizeText(entry.exerciseId, 80),
                    sets: clamp(Number(entry.sets || 3), 1, 12),
                    repRange: `${parseRepRange(entry.repRange).min}-${parseRepRange(entry.repRange).max}`,
                    rest: clamp(Number(entry.rest || 90), 15, 600),
                    tempo: sanitizeText(entry.tempo || '2-0-2', 16),
                    targetRpe: clamp(Number(entry.targetRpe || 8), 4, 10),
                    targetRir: clamp(Number(entry.targetRir || 2), 0, 6),
                  }))
                : [],
            }))
          : [],
      }));
      parsed.sessions = Array.isArray(parsed.sessions) ? parsed.sessions : [];
      parsed.recentExerciseIds = Array.isArray(parsed.recentExerciseIds)
        ? parsed.recentExerciseIds.map((id) => sanitizeText(String(id), 80)).filter(Boolean)
        : [];

      Object.assign(state, {
        exercises: parsed.exercises,
        templates: parsed.templates,
        sessions: parsed.sessions,
        recentExerciseIds: parsed.recentExerciseIds,
        ui: parsed.ui || state.ui,
        activeSession: parsed.activeSession || null,
      });
      await saveState();
      renderAll();
      el.importStatus.textContent = `Imported ${parsed.exercises.length} exercises, ${parsed.templates.length} templates, ${parsed.sessions.length} sessions.`;
      toast('Import successful.');
    } catch (error) {
      el.importStatus.textContent = `Import failed: ${error instanceof Error ? error.message : 'Invalid file.'}`;
      toast('Import failed.');
    } finally {
      el.importFile.value = '';
    }
  });
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  try {
    await navigator.serviceWorker.register('/service-worker.js');
  } catch {
    // Keep app working when SW cannot register.
  }
}

function cacheDOM() {
  Object.assign(el, {
    toast: document.getElementById('toast'),
    themeToggle: document.getElementById('theme-toggle'),
    exerciseForm: document.getElementById('exercise-form'),
    exerciseList: document.getElementById('exercise-list'),
    exerciseSearch: document.getElementById('exercise-search'),
    templateForm: document.getElementById('template-form'),
    templateSelect: document.getElementById('template-select'),
    daySelect: document.getElementById('day-select'),
    templateExerciseSelect: document.getElementById('template-exercise-select'),
    addTemplateExerciseForm: document.getElementById('add-template-exercise-form'),
    templateDayExercises: document.getElementById('template-day-exercises'),
    duplicateDayBtn: document.getElementById('duplicate-day'),
    logTemplateSelect: document.getElementById('log-template-select'),
    logDaySelect: document.getElementById('log-day-select'),
    startSession: document.getElementById('start-session'),
    sessionStatus: document.getElementById('session-status'),
    sessionPanel: document.getElementById('session-panel'),
    recentExercises: document.getElementById('recent-exercises'),
    analyticsExerciseSelect: document.getElementById('analytics-exercise-select'),
    historyChart: document.getElementById('history-chart'),
    oneRmChart: document.getElementById('onerm-chart'),
    analyticsSummary: document.getElementById('analytics-summary'),
    prList: document.getElementById('pr-list'),
    exportData: document.getElementById('export-data'),
    importFile: document.getElementById('import-file'),
    importStatus: document.getElementById('import-status'),
  });
}

function seedDataIfEmpty() {
  if (state.exercises.length || state.templates.length) return;
  const bench = {
    id: uid('ex'),
    name: 'Barbell Bench Press',
    muscleGroup: 'Chest',
    movementPattern: 'Horizontal Push',
    equipment: 'Barbell',
    unilateral: false,
    warmupNeeded: true,
    favorite: true,
  };
  const row = {
    id: uid('ex'),
    name: 'Seated Cable Row',
    muscleGroup: 'Back',
    movementPattern: 'Horizontal Pull',
    equipment: 'Cable',
    unilateral: false,
    warmupNeeded: true,
    favorite: false,
  };
  const squat = {
    id: uid('ex'),
    name: 'Back Squat',
    muscleGroup: 'Quads',
    movementPattern: 'Squat',
    equipment: 'Barbell',
    unilateral: false,
    warmupNeeded: true,
    favorite: true,
  };
  state.exercises.push(bench, row, squat);
  state.templates.push({
    id: uid('tpl'),
    name: 'Upper/Lower Starter',
    split: 'Upper/Lower',
    days: [
      {
        id: uid('day'),
        name: 'Upper A',
        exercises: [
          { exerciseId: bench.id, sets: 3, repRange: '6-8', rest: 120, tempo: '2-0-2', targetRpe: 8, targetRir: 2 },
          { exerciseId: row.id, sets: 3, repRange: '8-12', rest: 90, tempo: '2-1-2', targetRpe: 8, targetRir: 2 },
        ],
      },
      {
        id: uid('day'),
        name: 'Lower A',
        exercises: [{ exerciseId: squat.id, sets: 4, repRange: '5-8', rest: 150, tempo: '3-1-1', targetRpe: 8, targetRir: 2 }],
      },
    ],
  });
}

async function boot() {
  cacheDOM();
  await loadState();
  seedDataIfEmpty();
  if (!['system', 'light', 'dark'].includes(state.ui.theme)) state.ui.theme = 'system';
  setTheme(state.ui.theme);
  switchView(state.ui.activeView || 'plan');
  attachEvents();
  renderAll();
  await saveState();
  await registerServiceWorker();
}

boot().catch(() => {
  const msg = document.getElementById('main');
  if (msg) msg.textContent = 'Failed to initialize app. Please refresh.';
});
