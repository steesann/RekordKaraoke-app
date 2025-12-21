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

// Рендер лирики с плавными анимациями
let lastActiveIndex = -1;
let visibleLines = new Set();

function renderLyrics() {
  if (!lyrics || !lyrics.lines || lyrics.lines.length === 0) {
    lyricsEl.innerHTML = '';
    visibleLines.clear();
    lastActiveIndex = -1;
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

  // Окно отображения: 2 строки до, активная, 2 строки после
  // Делаем окно симметричным, чтобы активная строка была по центру блока
  // (так визуально “караоке” смотрится лучше).
  const LINES_BEFORE = 2;
  const LINES_AFTER = 2;
  const windowStart = Math.max(0, activeIndex - LINES_BEFORE);
  const windowEnd = Math.min(lyrics.lines.length, activeIndex + LINES_AFTER + 1);
  
  const newVisibleLines = new Set();
  for (let i = windowStart; i < windowEnd; i++) {
    newVisibleLines.add(i);
  }

  // Проверяем нужен ли полный перерендер
  const needsFullRender = !lyricsEl.children.length || 
    activeIndex < lastActiveIndex ||
    Math.abs(activeIndex - lastActiveIndex) > 2;

  if (needsFullRender) {
    renderFullLyrics(activeIndex, windowStart, windowEnd, newVisibleLines);
  } else {
    updateLyricsClasses(activeIndex, windowStart, windowEnd, newVisibleLines);
  }

  lastActiveIndex = activeIndex;
  visibleLines = newVisibleLines;
}

function renderFullLyrics(activeIndex, windowStart, windowEnd, newVisibleLines) {
  let html = '';
  
  for (let i = windowStart; i < windowEnd; i++) {
    const line = lyrics.lines[i];
    const classes = getLineClasses(i, activeIndex, !visibleLines.has(i));
    const delay = (i - windowStart) * 0.08;
    
    html += `<div class="${classes}" data-index="${i}" style="transition-delay: ${delay}s">${escapeHtml(line.text)}</div>`;
  }

  lyricsEl.innerHTML = html;

  // Триггерим анимацию появления через requestAnimationFrame
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const lines = lyricsEl.querySelectorAll('.lyric-line');
      lines.forEach(el => {
        el.classList.add('visible');
        el.classList.remove('entering');
      });
    });
  });
}

function updateLyricsClasses(activeIndex, windowStart, windowEnd, newVisibleLines) {
  const existingLines = lyricsEl.querySelectorAll('.lyric-line');
  const existingIndices = new Set();
  
  existingLines.forEach(el => {
    const idx = parseInt(el.dataset.index, 10);
    existingIndices.add(idx);
    
    if (!newVisibleLines.has(idx)) {
      // Строка уходит из окна — плавно скрываем
      el.classList.add('fading-out');
      el.classList.remove('visible');
    } else {
      // Обновляем классы
      el.className = getLineClasses(idx, activeIndex, false);
      el.classList.add('visible');
    }
  });

  // Добавляем новые строки
  for (let i = windowStart; i < windowEnd; i++) {
    if (!existingIndices.has(i)) {
      const line = lyrics.lines[i];
      const div = document.createElement('div');
      div.className = getLineClasses(i, activeIndex, true);
      div.dataset.index = i;
      div.textContent = line.text;
      
      // Вставляем в правильную позицию
      const insertBefore = Array.from(lyricsEl.children).find(el => 
        parseInt(el.dataset.index, 10) > i
      );
      
      if (insertBefore) {
        lyricsEl.insertBefore(div, insertBefore);
      } else {
        lyricsEl.appendChild(div);
      }

      // Анимация появления
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          div.classList.add('visible');
          div.classList.remove('entering');
        });
      });
    }
  }

  // Удаляем скрытые строки после анимации
  setTimeout(() => {
    const fadingOut = lyricsEl.querySelectorAll('.fading-out');
    fadingOut.forEach(el => el.remove());
  }, 600);
}

function getLineClasses(index, activeIndex, isNew) {
  let classes = 'lyric-line';
  
  if (index === activeIndex) {
    classes += ' active';
  } else if (index === activeIndex + 1) {
    classes += ' next';
  } else if (index > activeIndex + 1) {
    classes += ' upcoming';
  } else if (index < activeIndex) {
    classes += ' past';
  }
  
  if (isNew) {
    classes += ' entering';
  }
  
  return classes;
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
