/* Sticky Notes: the window.

   Everything here goes through `cloudwindow.request` to the plugin's program (provider.mjs),
   which keeps the notes on the computer. A note is plain text; a line that starts with
   "[ ] " or "[x] " is a checklist item, drawn as a checkbox you can tick without opening the
   note. Changes are saved as you type and reach every other open window of Sticky Notes. */
const cw = window.cloudwindow;
const origin = Math.random().toString(36).slice(2);
const $ = (id) => document.getElementById(id);
const grid = $('notes');

let notes = [];
let colors = ['yellow', 'green', 'blue', 'pink', 'purple', 'gray'];
let editing = null;                    // id of the note whose textarea is open
const cards = new Map();               // id -> card element
const timers = new Map();              // id -> pending save
const tookIntents = new Set();

const ICONS = {
  pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4h6l-1 6 3 3H7l3-3z"/><path d="M12 13v7"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="3"/><path d="m8.5 12 2.5 2.5 4.5-5"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12"/></svg>',
};

function problem(message) {
  $('problem').textContent = message || '';
  $('problem').hidden = !message;
  if (message) setTimeout(() => { if ($('problem').textContent === message) problem(''); }, 6000);
}
async function ask(message) {
  try { return await cw.request({ ...message, origin }); }
  catch (error) { problem(error.message); throw error; }
}

/* ---- drawing ---- */
const CHECK = /^(\s*)\[([ xX])\]\s?(.*)$/;
function when(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  const time = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (date.toDateString() === now.toDateString()) return `Today, ${time}`;
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return `Yesterday, ${time}`;
  return date.toLocaleDateString([], { month: 'short', day: 'numeric', ...(date.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) });
}
function drawBody(body, note) {
  body.replaceChildren();
  const text = note.text;
  if (!text.trim()) {
    const empty = document.createElement('div');
    empty.className = 'line placeholder'; empty.textContent = 'Write something…';
    body.append(empty);
    return;
  }
  text.split('\n').forEach((line, at) => {
    const match = CHECK.exec(line);
    if (!match) {
      const row = document.createElement('div');
      row.className = 'line'; row.textContent = line; row.dataset.line = String(at);
      body.append(row);
      return;
    }
    // A div, not a label: only the box ticks the item, and a click on its words opens the note.
    const row = document.createElement('div');
    const done = match[2] !== ' ';
    row.className = 'line check' + (done ? ' done' : ''); row.dataset.line = String(at);
    const box = document.createElement('input');
    box.type = 'checkbox'; box.checked = done; box.dataset.line = String(at);
    box.setAttribute('aria-label', match[3] || 'Checklist item');
    const label = document.createElement('span'); label.textContent = match[3];
    row.append(box, label);
    body.append(row);
  });
}
function makeCard(note) {
  const card = document.createElement('article');
  card.className = 'note'; card.dataset.id = note.id;
  card.innerHTML = `<span class="pin-mark" hidden>Pinned</span><div class="note-body" tabindex="0" role="button" aria-label="Edit note"></div>
    <div class="note-foot"><span class="when"></span><span class="swatches"></span>
    <button class="tool add-item" type="button" title="Add Checklist Item" aria-label="Add checklist item">${ICONS.check}</button>
    <button class="tool pin" type="button" title="Pin to Top" aria-label="Pin to top" aria-pressed="false">${ICONS.pin}</button>
    <button class="tool delete" type="button" title="Delete Note" aria-label="Delete note">${ICONS.trash}</button></div>`;
  const swatches = card.querySelector('.swatches');
  for (const color of colors) {
    const swatch = document.createElement('button');
    swatch.type = 'button'; swatch.className = 'swatch'; swatch.dataset.color = color;
    swatch.title = color[0].toUpperCase() + color.slice(1); swatch.setAttribute('aria-label', `Make it ${color}`);
    swatches.append(swatch);
  }
  cards.set(note.id, card);
  return card;
}
function fillCard(card, note) {
  card.dataset.color = note.color;
  card.querySelector('.pin-mark').hidden = !note.pinned;
  card.querySelector('.when').textContent = when(note.updated);
  const pin = card.querySelector('.pin');
  pin.setAttribute('aria-pressed', String(note.pinned));
  pin.title = note.pinned ? 'Unpin' : 'Pin to Top';
  for (const swatch of card.querySelectorAll('.swatch')) swatch.setAttribute('aria-pressed', String(swatch.dataset.color === note.color));
  if (editing !== note.id) {
    const body = card.querySelector('.note-body');
    if (body) drawBody(body, note);
  }
}
function render() {
  const query = $('search').value.trim().toLowerCase();
  const shown = new Set();
  let visible = 0;
  for (const note of notes) {
    const card = cards.get(note.id) || makeCard(note);
    fillCard(card, note);
    const match = !query || note.text.toLowerCase().includes(query);
    card.hidden = !match && editing !== note.id;
    if (!card.hidden) visible += 1;
    shown.add(note.id);
  }
  for (const [id, card] of cards) if (!shown.has(id)) { card.remove(); cards.delete(id); }
  // Put cards in order without moving the one being written in, which would take its focus.
  if (!editing) notes.forEach(note => grid.append(cards.get(note.id)));
  else {
    const order = notes.map(note => note.id);
    const current = [...grid.children].map(card => card.dataset.id);
    if (order.join() !== current.join()) for (const id of order) { const card = cards.get(id); if (!card.isConnected) grid.append(card); }
  }
  $('count').textContent = notes.length ? String(notes.length) : '';
  $('empty').hidden = notes.length > 0;
  grid.hidden = notes.length === 0;
  $('no-match').hidden = !(notes.length && query && !visible);
}

/* ---- writing ---- */
const noteOf = (id) => notes.find(note => note.id === id);
function queueSave(id, delay = 500) {
  clearTimeout(timers.get(id));
  timers.set(id, setTimeout(() => saveNow(id), delay));
}
async function saveNow(id) {
  clearTimeout(timers.get(id)); timers.delete(id);
  const note = noteOf(id);
  if (!note) return;
  const answer = await ask({ op: 'save', note: { id: note.id, text: note.text, color: note.color, pinned: note.pinned } }).catch(() => null);
  if (answer?.note) { const at = notes.findIndex(other => other.id === id); if (at >= 0) notes[at] = { ...answer.note, text: notes[at].text }; render(); }
}
function grow(area) { area.style.height = 'auto'; area.style.height = area.scrollHeight + 'px'; }

function edit(id, { caret = 'end' } = {}) {
  const card = cards.get(id), note = noteOf(id);
  if (!card || !note) return;
  if (editing && editing !== id) finish(editing);
  editing = id;
  const body = card.querySelector('.note-body');
  const area = document.createElement('textarea');
  area.value = note.text;
  area.setAttribute('aria-label', 'Note');
  area.spellcheck = true;
  body.replaceWith(area);
  grow(area);
  area.focus();
  const at = caret === 'end' ? area.value.length : caret;
  area.setSelectionRange(at, at);
  area.addEventListener('input', () => { note.text = area.value; grow(area); queueSave(id); });
  area.addEventListener('keydown', (event) => onKey(event, area, note));
  area.addEventListener('blur', () => { if (editing === id) finish(id); });
}
async function finish(id) {
  const card = cards.get(id), note = noteOf(id);
  editing = null;
  if (card) {
    const area = card.querySelector('textarea');
    const body = document.createElement('div');
    body.className = 'note-body'; body.tabIndex = 0; body.setAttribute('role', 'button'); body.setAttribute('aria-label', 'Edit note');
    if (area) area.replaceWith(body);
  }
  if (!note) return render();
  // A note left empty was never really written: it goes, rather than piling up blank cards.
  if (!note.text.trim()) { clearTimeout(timers.get(id)); timers.delete(id); notes = notes.filter(other => other.id !== id); render(); await ask({ op: 'delete', id }).catch(() => {}); return; }
  render();
  if (timers.has(id)) await saveNow(id);
}
/* Enter on a checklist item starts the next one; Enter on an empty item ends the list. */
function onKey(event, area, note) {
  if (event.key === 'Escape' || (event.key === 'Enter' && (event.metaKey || event.ctrlKey))) { event.preventDefault(); area.blur(); return; }
  if (event.key !== 'Enter' || event.shiftKey || event.altKey) return;
  const { selectionStart: start, selectionEnd: end, value } = area;
  if (start !== end) return;
  const lineStart = value.lastIndexOf('\n', start - 1) + 1;
  const line = value.slice(lineStart, start);
  const match = CHECK.exec(line);
  if (!match) return;
  event.preventDefault();
  if (!match[3].trim()) {
    area.setRangeText('', lineStart, start, 'end');
  } else {
    area.setRangeText(`\n${match[1]}[ ] `, start, end, 'end');
  }
  note.text = area.value; grow(area); queueSave(note.id);
}

/* A new note is drawn and ready for typing at once; it reaches the program with the first
   thing typed into it, and if nothing is, it was never a note. */
const newId = () => (crypto.randomUUID ? crypto.randomUUID() : Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join(''));
function create() {
  if (editing) finish(editing);
  $('search').value = '';
  const at = new Date().toISOString();
  const note = { id: newId(), text: '', color: notes.find(other => !other.pinned)?.color || 'yellow', pinned: false, created: at, updated: at };
  notes.splice(notes.filter(other => other.pinned).length, 0, note);
  render();
  cards.get(note.id)?.scrollIntoView({ block: 'nearest' });
  edit(note.id);
}
function reveal(id) {
  const card = cards.get(id);
  if (!card) return;
  $('search').value = ''; render();
  card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  card.classList.remove('flash'); void card.offsetWidth; card.classList.add('flash');
  edit(id);
}

let undo = null, toastTimer = null;
function toast(text, action) {
  $('toast-text').textContent = text;
  undo = action;
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('toast').hidden = true; undo = null; }, 6000);
}
$('toast-undo').addEventListener('click', async () => { const action = undo; undo = null; $('toast').hidden = true; if (action) await action(); });

/* ---- events on the cards ---- */
grid.addEventListener('click', async (event) => {
  const card = event.target.closest('.note');
  if (!card) return;
  const id = card.dataset.id, note = noteOf(id);
  if (!note) return;
  if (event.target.matches('.check input')) {
    const lines = note.text.split('\n');
    const at = Number(event.target.dataset.line);
    const match = CHECK.exec(lines[at] || '');
    if (match) { lines[at] = `${match[1]}[${event.target.checked ? 'x' : ' '}] ${match[3]}`; note.text = lines.join('\n'); render(); queueSave(id, 0); }
    return;
  }
  const swatch = event.target.closest('.swatch');
  if (swatch) { note.color = swatch.dataset.color; render(); queueSave(id, 0); return; }
  if (event.target.closest('.pin')) { note.pinned = !note.pinned; render(); await saveNow(id); return; }
  if (event.target.closest('.delete')) {
    if (editing === id) { editing = null; }
    clearTimeout(timers.get(id)); timers.delete(id);
    notes = notes.filter(other => other.id !== id); render();
    const answer = await ask({ op: 'delete', id }).catch(() => null);
    if (answer?.deleted && answer.deleted.text.trim()) {
      const gone = answer.deleted;
      toast('Note deleted.', async () => { const back = await ask({ op: 'restore', note: gone }).catch(() => null); if (back?.note && !noteOf(back.note.id)) { notes.push(back.note); await refresh(); } });
    }
    return;
  }
  if (event.target.closest('.add-item')) {
    const prefix = note.text && !note.text.endsWith('\n') ? '\n' : '';
    note.text = `${note.text}${prefix}[ ] `;
    queueSave(id);
    if (editing === id) { const area = card.querySelector('textarea'); area.value = note.text; grow(area); area.focus(); area.setSelectionRange(area.value.length, area.value.length); }
    else { render(); edit(id); }
    return;
  }
  if (event.target.closest('.note-body')) {
    // The caret goes to the end of the line that was clicked, or the end of the note.
    const line = event.target.closest('.line[data-line]');
    if (!line) return edit(id);
    const lines = note.text.split('\n'), at = Number(line.dataset.line);
    edit(id, { caret: lines.slice(0, at + 1).join('\n').length });
  }
});
grid.addEventListener('keydown', (event) => {
  const body = event.target.closest('.note-body');
  if (body && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); edit(body.closest('.note').dataset.id); }
});
// A pointer pressed on the toolbar of the note being written must not end the edit first.
grid.addEventListener('mousedown', (event) => { if (event.target.closest('.note-foot button') && event.target.closest('.note')?.dataset.id === editing) event.preventDefault(); });

$('new').addEventListener('click', create);
$('empty-new').addEventListener('click', create);
$('search').addEventListener('input', render);
$('search').addEventListener('keydown', (event) => { if (event.key === 'Escape') { $('search').value = ''; render(); } });

/* ---- staying in step with the program and the other windows ---- */
function adopt(list) {
  const mine = editing ? noteOf(editing) : null;
  notes = list.map(note => (mine && note.id === mine.id) ? { ...note, text: mine.text } : note);
  // A note being written here that another window deleted stays until this one finishes.
  if (mine && !notes.some(note => note.id === mine.id)) notes.unshift(mine);
  render();
}
async function act(intent) {
  if (!intent || tookIntents.has(intent.id)) return;
  tookIntents.add(intent.id);
  ask({ op: 'took', id: intent.id }).catch(() => {});
  if (intent.new) await create();
  else if (intent.open) reveal(intent.open);
}
async function refresh() {
  const answer = await ask({ op: 'list' }).catch(() => null);
  if (!answer) return;
  if (Array.isArray(answer.colors)) colors = answer.colors;
  adopt(answer.notes || []);
  if (answer.intent) await act(answer.intent);
}
cw.on((message) => {
  if (message?.type === 'notes' && message.origin !== origin) adopt(message.notes || []);
  else if (message?.type === 'notes') { /* our own change, already drawn */ }
  else if (message?.type === 'intent') act(message.intent);
});
addEventListener('focus', () => { if (!editing) refresh(); });
setInterval(() => { if (!editing) render(); }, 60_000);   // "Today, 2:04 PM" moves on to "Yesterday"
refresh();
