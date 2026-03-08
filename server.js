const express = require('express');
const path = require('path');
const fs = require('fs/promises');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

async function readJson(filename, fallback) {
  try {
    const raw = await fs.readFile(path.join(DATA_DIR, filename), 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    return fallback;
  }
}

async function writeJson(filename, data) {
  const filePath = path.join(DATA_DIR, filename);
  await fs.writeFile(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

app.get('/api/channels', async (req, res) => {
  const data = await readJson('channels.json', { channels: [] });
  res.json(data);
});

app.get('/api/guidelines', async (req, res) => {
  const data = await readJson('guidelines.json', {});
  res.json(data);
});

app.put('/api/guidelines/:channel', async (req, res) => {
  const channel = req.params.channel;
  const { text = '', purpose = '' } = req.body || {};
  const data = await readJson('guidelines.json', {});
  data[channel] = { text, purpose };
  await writeJson('guidelines.json', data);
  res.json({ ok: true, channel });
});

app.get('/api/ideas', async (req, res) => {
  const data = await readJson('ideas.json', { ideas: [] });
  res.json(data);
});

app.post('/api/ideas', async (req, res) => {
  const { title = '', brief = '', tension = '', point = '', cta = '' } = req.body || {};
  const data = await readJson('ideas.json', { ideas: [] });
  const idea = {
    id: `idea_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    title,
    brief,
    tension,
    point,
    cta,
    createdAt: new Date().toISOString()
  };
  data.ideas.unshift(idea);
  await writeJson('ideas.json', data);
  res.json({ ok: true, idea });
});

app.put('/api/ideas/:id', async (req, res) => {
  const id = req.params.id;
  const update = req.body || {};
  const data = await readJson('ideas.json', { ideas: [] });
  const idx = data.ideas.findIndex(i => i.id === id);
  if (idx === -1) return res.status(404).json({ ok: false });
  data.ideas[idx] = { ...data.ideas[idx], ...update };
  await writeJson('ideas.json', data);
  res.json({ ok: true, idea: data.ideas[idx] });
});

app.delete('/api/ideas/:id', async (req, res) => {
  const id = req.params.id;
  const data = await readJson('ideas.json', { ideas: [] });
  const next = data.ideas.filter(i => i.id !== id);
  data.ideas = next;
  await writeJson('ideas.json', data);
  res.json({ ok: true });
});

app.get('/api/schedule', async (req, res) => {
  const data = await readJson('schedule.json', { schedule: [] });
  res.json(data);
});

app.post('/api/schedule', async (req, res) => {
  const { date = '', channel = '', ideaIds = [], notes = '' } = req.body || {};
  const data = await readJson('schedule.json', { schedule: [] });
  const entry = {
    id: `sched_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    date,
    channel,
    ideaIds,
    notes,
    createdAt: new Date().toISOString()
  };
  data.schedule.unshift(entry);
  await writeJson('schedule.json', data);
  res.json({ ok: true, entry });
});

app.put('/api/schedule/:id', async (req, res) => {
  const id = req.params.id;
  const update = req.body || {};
  const data = await readJson('schedule.json', { schedule: [] });
  const idx = data.schedule.findIndex(i => i.id === id);
  if (idx === -1) return res.status(404).json({ ok: false });
  data.schedule[idx] = { ...data.schedule[idx], ...update };
  await writeJson('schedule.json', data);
  res.json({ ok: true, entry: data.schedule[idx] });
});

app.delete('/api/schedule/:id', async (req, res) => {
  const id = req.params.id;
  const data = await readJson('schedule.json', { schedule: [] });
  data.schedule = data.schedule.filter(i => i.id !== id);
  await writeJson('schedule.json', data);
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`Content planner running on http://localhost:${PORT}`);
});
