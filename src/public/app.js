/**
 * RekordKaraoke Frontend
 * Плавные анимации, текст по дуге, интерполяция времени
 */

// Elements
const app = document.getElementById('app');
const artistEl = document.getElementById('artist');
const titleEl = document.getElementById('title');
const lyricsEl = document.getElementById('lyrics');
const lyricsWrapper = document.getElementById('lyrics-wrapper');
const currentTimeEl = document.getElementById('current-time');
const bpmEl = document.getElementById('bpm');
const progressFill = document.getElementById('progress-fill');
const coverImage = document.getElementById('cover-image');
const coverPlaceholder = document.getElementById('cover-placeholder');

// State
let lyrics = null;
let ws = null;
let isConnected = false;
let lastActiveIndex = -1;

// Интерполяция времени (локальные часы)
let serverTime = 0;           // последнее время от сервера
let serverTimestamp = 0;      // Date.now() когда получили serverTime
let isPlaying = true;         // считаем что играет (пока нет паузы от сервера)
let animationFrameId = null;

// Количество строк для отображения (до и после активной)
const LINES_BEFORE = 3;
const LINES_AFTER = 4;

// === UTILITIES ===

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Получить текущее интерполированное время
 */
function getCurrentTime() {
  if (!isPlaying || serverTimestamp === 0) {
    return serverTime;
  }
  const elapsed = (Date.now() - serverTimestamp) / 1000;
  return serverTime + elapsed;
}

// === COVER IMAGE ===

function updateCover(artist, title) {
  if (!artist || !title) {
    coverImage.style.display = 'none';
    coverPlaceholder.style.display = 'flex';
    return;
  }
  
  // Путь к обложке: /covers/Artist_-_Title.jpg
  const safeName = `${artist}_-_${title}`
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, '_');
  
  const coverPath = `/covers/${safeName}.jpg`;
  
  // Пробуем загрузить
  const img = new Image();
  img.onload = () => {
    coverImage.src = coverPath;
    coverImage.style.display = 'block';
    coverPlaceholder.style.display = 'none';
  };
  img.onerror = () => {
    coverImage.style.display = 'none';
    coverPlaceholder.style.display = 'flex';
  };
  img.src = coverPath;
}

// === LYRICS RENDERING ===

function findActiveIndex(time) {
  if (!lyrics || !lyrics.lines || lyrics.lines.length === 0) {
    return -1;
  }
  
  for (let i = lyrics.lines.length - 1; i >= 0; i--) {
    if (time >= lyrics.lines[i].time) {
      return i;
    }
  }
  return -1;
}

function renderLyrics(time) {
  if (!lyrics || !lyrics.lines || lyrics.lines.length === 0) {
    lyricsEl.innerHTML = '';
    lastActiveIndex = -1;
    return;
  }

  const activeIndex = findActiveIndex(time);
  
  // Если активная строка не изменилась, не перерендериваем
  if (activeIndex === lastActiveIndex && lyricsEl.children.length > 0) {
    return;
  }
  
  // Определяем окно отображения
  const windowStart = Math.max(0, activeIndex - LINES_BEFORE);
  const windowEnd = Math.min(lyrics.lines.length, activeIndex + LINES_AFTER + 1);

  // Проверяем нужен ли полный перерендер
  const existingLines = lyricsEl.querySelectorAll('.lyric-line');
  const existingIndices = new Set();
  existingLines.forEach(el => existingIndices.add(parseInt(el.dataset.index, 10)));

  // Собираем нужные индексы
  const neededIndices = new Set();
  for (let i = windowStart; i < windowEnd; i++) {
    neededIndices.add(i);
  }

  // Проверяем совпадают ли наборы
  let needsFullRender = existingIndices.size !== neededIndices.size;
  if (!needsFullRender) {
    for (const idx of neededIndices) {
      if (!existingIndices.has(idx)) {
        needsFullRender = true;
        break;
      }
    }
  }

  if (needsFullRender) {
    // Полный перерендер (при смене трека или большом скачке)
    let html = '';
    for (let i = windowStart; i < windowEnd; i++) {
      const line = lyrics.lines[i];
      const className = getLineClass(i, activeIndex);
      html += `<div class="lyric-line ${className}" data-index="${i}">${escapeHtml(line.text)}</div>`;
    }
    lyricsEl.innerHTML = html;
  } else {
    // Инкрементальное обновление классов
    existingLines.forEach(el => {
      const idx = parseInt(el.dataset.index, 10);
      const newClass = getLineClass(idx, activeIndex);
      
      // Убираем старые классы позиционирования
      el.classList.remove('active', 'past-1', 'past-2', 'past-3', 'next-1', 'next-2', 'next-3', 'next-4');
      
      // Добавляем новый класс
      if (newClass) {
        el.classList.add(newClass);
      }
    });
  }

  lastActiveIndex = activeIndex;
}

function getLineClass(index, activeIndex) {
  const diff = index - activeIndex;
  
  if (diff === 0) return 'active';
  if (diff === -1) return 'past-1';
  if (diff === -2) return 'past-2';
  if (diff <= -3) return 'past-3';
  if (diff === 1) return 'next-1';
  if (diff === 2) return 'next-2';
  if (diff === 3) return 'next-3';
  if (diff >= 4) return 'next-4';
  
  return '';
}

// === PROGRESS ===

function updateProgress(time) {
  if (!lyrics || !lyrics.lines || lyrics.lines.length === 0) {
    progressFill.style.width = '0%';
    return;
  }

  const duration = lyrics.duration || 
    (lyrics.lines[lyrics.lines.length - 1].endTime) || 
    (lyrics.lines[lyrics.lines.length - 1].time + 30);
  const progress = Math.min(100, Math.max(0, (time / duration) * 100));
  progressFill.style.width = `${progress}%`;
}

// === ANIMATION LOOP ===

function tick() {
  const time = getCurrentTime();
  
  // Обновляем UI
  currentTimeEl.textContent = formatTime(time);
  renderLyrics(time);
  updateProgress(time);
  
  // Продолжаем цикл
  animationFrameId = requestAnimationFrame(tick);
}

function startAnimationLoop() {
  if (animationFrameId === null) {
    animationFrameId = requestAnimationFrame(tick);
  }
}

function stopAnimationLoop() {
  if (animationFrameId !== null) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
}

// === FALLBACK DISPLAY ===

function updateFallback(artist, title) {
  if (artist && title) {
    lyricsWrapper.setAttribute('data-fallback', `${artist}\n—\n${title}`);
  } else {
    lyricsWrapper.setAttribute('data-fallback', '');
  }
}

// === WEBSOCKET ===

function connect() {
  const wsUrl = `ws://${location.hostname}:${location.port || 3000}`;
  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    console.log('Connected to server');
    isConnected = true;
    app.classList.remove('disconnected');
    startAnimationLoop();
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
      
      // Синхронизация времени
      serverTime = msg.data.time || 0;
      serverTimestamp = Date.now();
      
      bpmEl.textContent = msg.data.bpm ? `${Math.round(msg.data.bpm)} BPM` : '— BPM';
      lyrics = msg.data.lyrics;
      app.className = `status-${msg.data.lyricsStatus}`;
      updateFallback(msg.data.artist, msg.data.title);
      
      // Обложка от сервера или локальная
      if (msg.data.coverUrl) {
        setCover(msg.data.coverUrl);
      } else {
        updateCover(msg.data.artist, msg.data.title);
      }
      
      lastActiveIndex = -1;
      break;

    case 'track':
      artistEl.textContent = msg.data.artist || '—';
      titleEl.textContent = msg.data.title || '—';
      lyrics = null;
      lastActiveIndex = -1;
      serverTime = 0;
      serverTimestamp = Date.now();
      app.className = `status-${msg.data.status}`;
      updateFallback(msg.data.artist, msg.data.title);
      // Сбрасываем обложку, будет загружена по событию cover
      coverImage.style.display = 'none';
      coverPlaceholder.style.display = 'flex';
      lyricsEl.innerHTML = '';
      progressFill.style.width = '0%';
      break;

    case 'lyrics':
      app.className = `status-${msg.data.status}`;
      if (msg.data.status === 'found' && msg.data.lyrics) {
        lyrics = msg.data.lyrics;
        lastActiveIndex = -1;
      }
      break;

    case 'cover':
      if (msg.data) {
        setCover(msg.data);
      }
      break;

    case 'time':
      // Синхронизация с сервером
      serverTime = msg.data;
      serverTimestamp = Date.now();
      break;

    case 'bpm':
      bpmEl.textContent = `${Math.round(msg.data)} BPM`;
      break;
  }
}

/**
 * Устанавливает обложку напрямую по URL
 */
function setCover(url) {
  const img = new Image();
  img.onload = () => {
    coverImage.src = url;
    coverImage.style.display = 'block';
    coverPlaceholder.style.display = 'none';
  };
  img.onerror = () => {
    coverImage.style.display = 'none';
    coverPlaceholder.style.display = 'flex';
  };
  img.src = url;
}

// === INIT ===
connect();
