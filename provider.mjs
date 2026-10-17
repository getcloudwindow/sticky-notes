/* Sticky Notes: the program half.

   Notes live in one file in this plugin's data folder on the computer, so every device that
   opens the desktop sees the same notes, and a restart loses nothing. This program is the
   only thing that reads or writes that file. The window (app/) asks it for the notes and sends
   it each change; the menu bar widget shows the newest; and every open window hears about a
   change made in another one, so two devices never show two versions of a note. */
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

const cw = globalThis.cloudwindow;
const { dataDir } = await cw.ready;
const file = join(dataDir, 'notes.json');

const MAX_NOTES = 500, MAX_TEXT = 20_000;
const COLORS = ['yellow', 'green', 'blue', 'pink', 'purple', 'gray'];

let notes = [];
try {
  const saved = JSON.parse(readFileSync(file, 'utf8'));
  if (Array.isArray(saved.notes)) notes = saved.notes.map(clean).filter(Boolean);
} catch (error) {
  // A file that is there but cannot be read is kept aside, never overwritten by the next save.
  if (error.code !== 'ENOENT') {
    const aside = `${file}.unreadable-${Date.now()}`;
    try { renameSync(file, aside); cw.error(`notes.json could not be read and was kept as ${aside}.`); } catch {}
  }
}

function clean(input) {
  if (!input || typeof input !== 'object') return null;
  const at = new Date().toISOString();
  const id = typeof input.id === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(input.id) ? input.id : randomUUID();
  return {
    id,
    text: String(input.text ?? '').slice(0, MAX_TEXT),
    color: COLORS.includes(input.color) ? input.color : 'yellow',
    pinned: !!input.pinned,
    created: typeof input.created === 'string' ? input.created : at,
    updated: typeof input.updated === 'string' ? input.updated : at,
  };
}
// Pinned first, then newest first by when the note was started, so a note does not jump while it is being written.
const order = (list) => [...list].sort((a, b) => (b.pinned - a.pinned) || (a.created < b.created ? 1 : a.created > b.created ? -1 : 0));

let writing = null;
function save() {
  // One write at a time, always of the latest notes: a burst of typing is one file write.
  if (writing) { writing.again = true; return; }
  writing = { again: false };
  setTimeout(() => {
    try {
      writeFileSync(file + '.tmp', JSON.stringify({ version: 1, notes }));
      renameSync(file + '.tmp', file);
    } catch (error) { cw.error(`Could not save notes: ${error.message}`); }
    const again = writing.again;
    writing = null;
    if (again) save();
  }, 250);
}
cw.on('stop', () => {
  try { writeFileSync(file + '.tmp', JSON.stringify({ version: 1, notes })); renameSync(file + '.tmp', file); } catch {}
});

/* ---- the menu bar ---- */
const firstLine = (text) => (String(text).split('\n').find(line => line.trim()) || '').replace(/^\s*\[[ xX]\]\s*/, '').trim();
const secondLine = (text) => { const lines = String(text).split('\n').filter(line => line.trim()); return (lines[1] || '').replace(/^\s*\[[ xX]\]\s*/, '').trim(); };
const shorten = (text, max) => { const plain = text.replace(/</g, '‹').replace(/\s+/g, ' '); return plain.length > max ? plain.slice(0, max - 1).trimEnd() + '…' : plain; };

let drawn = '';
async function draw() {
  const sorted = order(notes);
  const rows = [{ label: 'New Note', value: '⌥⇧N', action: cw.signal('new') }];
  for (const note of sorted.slice(0, 9)) {
    rows.push({
      label: shorten(firstLine(note.text) || 'Empty note', 40),
      ...(secondLine(note.text) ? { detail: shorten(secondLine(note.text), 80) } : {}),
      ...(note.pinned ? { value: 'Pinned' } : {}),
      action: cw.signal('open', { id: note.id }),
    });
  }
  rows.push({ label: notes.length > 9 ? `Show All ${notes.length} Notes` : 'Show Sticky Notes', action: cw.signal('show') });
  const declaration = {
    compact: { label: 'Notes', icon: 'file', ...(cw.settings.showCount !== false && notes.length ? { value: String(notes.length) } : {}) },
    popover: { title: 'Sticky Notes', rows },
    placement: { cluster: 'right' },
    reason: 'The Sticky Notes plugin',
  };
  const signature = JSON.stringify(declaration);
  if (signature === drawn) return;
  drawn = signature;
  await cw.widget('notes', declaration).catch(error => { drawn = ''; cw.error(error.message); });
  cw.status(`${notes.length} note${notes.length === 1 ? '' : 's'}`);
}
let drawTimer = null;
const redraw = () => { clearTimeout(drawTimer); drawTimer = setTimeout(() => draw(), 300); };

/* ---- what the window asks for ---- */
/* An intent is what a button outside the window wanted it to do: start a new note, or show
   one. A window that is already open hears it straight away; one that is opening asks for it
   when it loads. Either way it is acted on once, and it expires after a short while. */
let intent = null;
const want = (what) => { intent = { id: randomUUID(), at: Date.now(), ...what }; cw.app.send({ type: 'intent', intent }); };
const pendingIntent = () => intent && Date.now() - intent.at < 15_000 ? intent : null;

function changed(origin) {
  save(); redraw();
  cw.app.send({ type: 'notes', notes: order(notes), origin: origin || null });
}

cw.app.handle(async (message) => {
  const op = message?.op;
  if (op === 'list') return { notes: order(notes), intent: pendingIntent(), colors: COLORS };
  if (op === 'took') { if (intent && intent.id === message.id) intent = null; return { ok: true }; }
  if (op === 'save') {
    const input = message.note || {};
    const existing = notes.find(note => note.id === input.id);
    if (!existing && notes.length >= MAX_NOTES) throw new Error(`Sticky Notes holds up to ${MAX_NOTES} notes. Delete a few first.`);
    const at = new Date().toISOString();
    const note = clean({ ...existing, ...input, id: existing?.id || input.id, created: existing?.created || at, updated: at });
    if (existing) Object.assign(existing, note); else notes.push(note);
    changed(message.origin);
    return { note };
  }
  if (op === 'delete') {
    const at = notes.findIndex(note => note.id === message.id);
    if (at < 0) return { deleted: null };
    const [gone] = notes.splice(at, 1);
    changed(message.origin);
    return { deleted: gone };
  }
  if (op === 'restore') {
    const note = clean(message.note);
    if (!note || notes.some(other => other.id === note.id)) return { note: null };
    if (notes.length >= MAX_NOTES) throw new Error(`Sticky Notes holds up to ${MAX_NOTES} notes.`);
    notes.push(note);
    changed(message.origin);
    return { note };
  }
  throw new Error(`Sticky Notes does not know "${String(op)}".`);
});

cw.on('signal', async (name, data) => {
  if (name === 'new') want({ new: true });
  else if (name === 'open' && typeof data?.id === 'string') want({ open: data.id });
  else if (name !== 'show') return;
  await cw.app.open().catch(error => cw.error(`Could not open the window: ${error.message}`));
});
cw.on('settings', () => { drawn = ''; return draw(); });
await draw();
