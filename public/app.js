const statusEl = document.getElementById('status');

const state = {
  channels: [],
  guidelines: {},
  ideas: [],
  schedule: []
};

function setStatus(message) {
  statusEl.textContent = message;
}

async function fetchJson(url, options) {
  const res = await fetch(url, options);
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return res.json();
}

function $(id) {
  return document.getElementById(id);
}

function switchPanel(targetId) {
  document.querySelectorAll('.panel').forEach(panel => {
    panel.classList.toggle('active', panel.id === targetId);
  });
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.section === targetId);
  });
}

function splitIntoLines(text) {
  if (!text) return [];
  return text
    .split(/\n+/)
    .flatMap(line => line.split(/(?<=[.!?])\s+/))
    .map(line => line.trim())
    .filter(Boolean);
}

function addSpacing(lines, interval) {
  const spaced = [];
  lines.forEach((line, idx) => {
    spaced.push(line);
    if ((idx + 1) % interval === 0 && idx !== lines.length - 1) {
      spaced.push('');
    }
  });
  return spaced;
}

function formatLinkedIn(idea, type, includeCta) {
  let lines = [];
  if (idea.title) lines.push(idea.title);
  if (idea.tension) lines.push(idea.tension);
  lines = lines.concat(splitIntoLines(idea.brief));
  if (idea.point) lines.push(idea.point);

  let maxLines = 6;
  let spacing = 3;
  if (type === 'medium') {
    maxLines = 12;
    spacing = 4;
  }
  if (type === 'long') {
    maxLines = 25;
    spacing = 3;
  }

  lines = lines.filter(Boolean).slice(0, maxLines);

  if (includeCta && idea.cta && type !== 'short') {
    lines.push('');
    lines.push(idea.cta);
  }

  if (type === 'short') {
    return lines.join('\n');
  }

  return addSpacing(lines, spacing).join('\n');
}

function formatDefault(idea, includeCta) {
  const parts = [];
  if (idea.title) parts.push(idea.title);
  if (idea.brief) parts.push(idea.brief);
  if (idea.point) parts.push(idea.point);
  if (includeCta && idea.cta) parts.push(idea.cta);
  return parts.filter(Boolean).join('\n\n');
}

function renderGuidelines() {
  const channelSelect = $('guidelineChannel');
  channelSelect.innerHTML = state.channels
    .map(ch => `<option value="${ch}">${ch}</option>`)
    .join('');

  channelSelect.addEventListener('change', () => {
    const channel = channelSelect.value;
    const data = state.guidelines[channel] || { text: '', purpose: '' };
    $('guidelinePurpose').value = data.purpose || '';
    $('guidelineText').value = data.text || '';
  });

  if (state.channels.length) {
    channelSelect.value = state.channels[0];
    channelSelect.dispatchEvent(new Event('change'));
  }
}

function renderChannels() {
  const selects = [$('planChannel'), $('genChannel')];
  selects.forEach(select => {
    select.innerHTML = state.channels
      .map(ch => `<option value="${ch}">${ch}</option>`)
      .join('');
  });
}

function renderIdeas() {
  const list = $('ideaList');
  const picker = $('genIdeas');
  const search = $('ideaSearch').value.toLowerCase();

  const filtered = state.ideas.filter(idea =>
    [idea.title, idea.brief, idea.tension, idea.point]
      .join(' ')
      .toLowerCase()
      .includes(search)
  );

  list.innerHTML = filtered
    .map(
      idea => `
      <div class="idea-card">
        <h4>${idea.title || 'Untitled idea'}</h4>
        <div class="idea-meta">ID: ${idea.id}</div>
        <p>${idea.brief || ''}</p>
        <div class="idea-actions">
          <button class="small-btn" data-copy="${idea.id}">Copy ID</button>
          <button class="small-btn" data-delete="${idea.id}">Delete</button>
        </div>
      </div>
    `
    )
    .join('');

  picker.innerHTML = filtered
    .map(
      idea => `
      <label>
        <input type="radio" name="genIdea" value="${idea.id}" />
        <div>
          <strong>${idea.title || 'Untitled idea'}</strong><br />
          <span class="idea-meta">${idea.brief || ''}</span>
        </div>
      </label>
    `
    )
    .join('');

  list.querySelectorAll('[data-copy]').forEach(btn => {
    btn.addEventListener('click', async () => {
      await navigator.clipboard.writeText(btn.dataset.copy);
      setStatus('Idea ID copied');
    });
  });

  list.querySelectorAll('[data-delete]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.delete;
      await fetchJson(`/api/ideas/${id}`, { method: 'DELETE' });
      await loadAll();
      setStatus('Idea deleted');
    });
  });
}

function renderSchedule() {
  const list = $('planList');
  list.innerHTML = state.schedule
    .map(entry => {
      const ideaLabel = entry.ideaIds && entry.ideaIds.length
        ? `Ideas: ${entry.ideaIds.join(', ')}`
        : 'Ideas: none';
      return `
        <div class="idea-card">
          <h4>${entry.date || 'No date'} - ${entry.channel}</h4>
          <div class="idea-meta">${ideaLabel}</div>
          <p>${entry.notes || ''}</p>
          <div class="idea-actions">
            <button class="small-btn" data-delete-schedule="${entry.id}">Delete</button>
          </div>
        </div>
      `;
    })
    .join('');

  list.querySelectorAll('[data-delete-schedule]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.deleteSchedule;
      await fetchJson(`/api/schedule/${id}`, { method: 'DELETE' });
      await loadAll();
      setStatus('Plan deleted');
    });
  });
}

async function loadAll() {
  const [channels, guidelines, ideas, schedule] = await Promise.all([
    fetchJson('/api/channels'),
    fetchJson('/api/guidelines'),
    fetchJson('/api/ideas'),
    fetchJson('/api/schedule')
  ]);

  state.channels = channels.channels || [];
  state.guidelines = guidelines || {};
  state.ideas = ideas.ideas || [];
  state.schedule = schedule.schedule || [];

  renderGuidelines();
  renderChannels();
  renderIdeas();
  renderSchedule();
}

function setupEvents() {
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => switchPanel(btn.dataset.section));
  });

  $('saveGuidelines').addEventListener('click', async () => {
    const channel = $('guidelineChannel').value;
    const payload = {
      purpose: $('guidelinePurpose').value.trim(),
      text: $('guidelineText').value.trim()
    };
    await fetchJson(`/api/guidelines/${encodeURIComponent(channel)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    setStatus('Guidelines saved');
  });

  $('addIdea').addEventListener('click', async () => {
    const payload = {
      title: $('ideaTitle').value.trim(),
      brief: $('ideaBrief').value.trim(),
      tension: $('ideaTension').value.trim(),
      point: $('ideaPoint').value.trim(),
      cta: $('ideaCta').value.trim()
    };
    if (!payload.title && !payload.brief) {
      setStatus('Add a title or brief');
      return;
    }
    await fetchJson('/api/ideas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    $('ideaTitle').value = '';
    $('ideaBrief').value = '';
    $('ideaTension').value = '';
    $('ideaPoint').value = '';
    $('ideaCta').value = '';
    await loadAll();
    setStatus('Idea saved');
  });

  $('ideaSearch').addEventListener('input', renderIdeas);

  $('addPlan').addEventListener('click', async () => {
    const payload = {
      date: $('planDate').value,
      channel: $('planChannel').value,
      ideaIds: $('planIdeas').value
        .split(',')
        .map(id => id.trim())
        .filter(Boolean),
      notes: $('planNotes').value.trim()
    };
    if (!payload.date || !payload.channel) {
      setStatus('Select date and channel');
      return;
    }
    await fetchJson('/api/schedule', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    $('planDate').value = '';
    $('planIdeas').value = '';
    $('planNotes').value = '';
    await loadAll();
    setStatus('Plan saved');
  });

  $('generate').addEventListener('click', () => {
    const channel = $('genChannel').value;
    const type = $('genType').value;
    const includeCta = $('genIncludeCta').checked;
    const selected = document.querySelector('input[name="genIdea"]:checked');

    if (!selected) {
      setStatus('Select one idea');
      return;
    }

    const idea = state.ideas.find(i => i.id === selected.value);
    if (!idea) {
      setStatus('Idea not found');
      return;
    }

    let output = '';
    if (channel === 'LinkedIn') {
      output = formatLinkedIn(idea, type, includeCta);
    } else {
      output = formatDefault(idea, includeCta);
    }

    $('genOutput').value = output;
    setStatus('Draft generated');
  });

  $('copyOutput').addEventListener('click', async () => {
    const value = $('genOutput').value.trim();
    if (!value) {
      setStatus('Nothing to copy');
      return;
    }
    await navigator.clipboard.writeText(value);
    setStatus('Copied');
  });
}

loadAll()
  .then(setupEvents)
  .catch(err => {
    console.error(err);
    setStatus('Failed to load data');
  });
