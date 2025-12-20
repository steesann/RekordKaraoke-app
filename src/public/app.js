/**
 * RekordKaraoke Frontend
 */

const app = document.getElementById('app');
const artistEl = document.getElementById('artist');
const titleEl = document.getElementById('title');
const lyricsEl = document.getElementById('lyrics');
const currentTimeEl = document.getElementById('current-time');
const bpmEl = document.getElementById('bpm');
const progressFill = document.getElementById('progress-fill');

let lyrics = null;
let currentTime = 0;
let ws = null;

// Форматирование времени
function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// Рендер лирики
function renderLyrics() {
  if (!lyrics || !lyrics.lines || lyrics.lines.length === 0) {
    lyricsEl.innerHTML = '';
    return;
  }

  // Находим текущую строку
  let activeIndex = -1;
  for (let i = lyrics.lines.length - 1; i >= 0; i--) {
    if (currentTime >= lyrics.lines[i].time) {
      activeIndex = i;
      break;
    }
  }

  // Показываем окно: 2 строки до, активная, 3 строки после
  const windowStart = Math.max(0, activeIndex - 2);
  const windowEnd = Math.min(lyrics.lines.length, activeIndex + 4);

  let html = '';
  for (let i = windowStart; i < windowEnd; i++) {
    const line = lyrics.lines[i];
    let className = 'lyric-line';
    
    if (i === activeIndex) {
      className += ' active';
    } else if (i < activeIndex) {
      className += ' past';
    } else if (i === activeIndex + 1) {
      className += ' next';
    }

    html += `<div class="${className}">${escapeHtml(line.text)}</div>`;
  }

  lyricsEl.innerHTML = html;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Обновление прогресса
function updateProgress() {
  if (!lyrics || !lyrics.lines || lyrics.lines.length === 0) {
    progressFill.style.width = '0%';
    return;
  }

  // Примерная длительность = время последней строки + 5 сек
  const duration = lyrics.lines[lyrics.lines.length - 1].endTime || 
                   lyrics.lines[lyrics.lines.length - 1].time + 5;
  const progress = Math.min(100, (currentTime / duration) * 100);
  progressFill.style.width = `${progress}%`;
}

// WebSocket подключение
let isConnected = false;

function connect() {
  const wsUrl = `ws://${location.hostname}:${location.port || 3000}`;
  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    console.log('Connected to server');
    isConnected = true;
    app.classList.remove('disconnected');
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      handleMessage(msg);
    } catch (err) {
      console.error('Failed to parse message:', err);
    }
  };

  ws.onclose = () => {
    console.log('Disconnected, reconnecting in 2s...');
    isConnected = false;
    app.classList.add('disconnected');
    setTimeout(connect, 2000);
  };

  ws.onerror = (err) => {
    console.error('WebSocket error:', err);
  };
}

function handleMessage(msg) {
  switch (msg.type) {
    case 'state':
      // Полное состояние при подключении
      artistEl.textContent = msg.data.artist || '—';
      titleEl.textContent = msg.data.title || 'Waiting for track...';
      currentTime = msg.data.time || 0;
      bpmEl.textContent = msg.data.bpm ? `${Math.round(msg.data.bpm)} BPM` : '— BPM';
      lyrics = msg.data.lyrics;
      app.className = `status-${msg.data.lyricsStatus}`;
      updateFallback(msg.data.artist, msg.data.title);
      renderLyrics();
      updateProgress();
      break;

    case 'track':
      artistEl.textContent = msg.data.artist || '—';
      titleEl.textContent = msg.data.title || '—';
      lyrics = null;
      app.className = `status-${msg.data.status}`;
      updateFallback(msg.data.artist, msg.data.title);
      lyricsEl.innerHTML = '';
      progressFill.style.width = '0%';
      break;

    case 'lyrics':
      app.className = `status-${msg.data.status}`;
      if (msg.data.status === 'found' && msg.data.lyrics) {
        lyrics = msg.data.lyrics;
        renderLyrics();
      }
      break;

    case 'time':
      currentTime = msg.data;
      currentTimeEl.textContent = formatTime(currentTime);
      renderLyrics();
      updateProgress();
      break;

    case 'bpm':
      bpmEl.textContent = `${Math.round(msg.data)} BPM`;
      break;
  }
}

function updateFallback(artist, title) {
  if (artist && title) {
    lyricsEl.setAttribute('data-fallback', `${artist} — ${title}`);
  } else {
    lyricsEl.setAttribute('data-fallback', '');
  }
}

// Старт
connect();
