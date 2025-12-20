/**
 * LRC Parser
 * Формат: [mm:ss.xx] текст строки
 */

function parseTimestamp(ts) {
  // [mm:ss.xx] или [mm:ss:xx]
  const match = ts.match(/(\d+):(\d+)[.:](\d+)/);
  if (!match) return null;
  
  const minutes = parseInt(match[1], 10);
  const seconds = parseInt(match[2], 10);
  const ms = parseInt(match[3].padEnd(3, '0').slice(0, 3), 10);
  
  return minutes * 60 + seconds + ms / 1000;
}

function parse(content) {
  const lines = content.split(/\r?\n/);
  const result = {
    meta: {},
    lines: []
  };

  for (const line of lines) {
    // Метаданные: [ti:Title], [ar:Artist], [al:Album], [offset:+/-ms]
    const metaMatch = line.match(/^\[(\w+):(.+)\]$/);
    if (metaMatch) {
      const [, key, value] = metaMatch;
      result.meta[key.toLowerCase()] = value.trim();
      continue;
    }

    // Тайм-коды: [00:12.34] текст
    // Может быть несколько тайм-кодов на строку: [00:12.34][00:45.67] текст
    const timestamps = [];
    let text = line;
    let match;
    
    while ((match = text.match(/^\[(\d+:\d+[.:]\d+)\]/))) {
      const time = parseTimestamp(match[1]);
      if (time !== null) timestamps.push(time);
      text = text.slice(match[0].length);
    }

    text = text.trim();
    if (timestamps.length === 0 || !text) continue;

    // Добавляем строку для каждого тайм-кода
    for (const time of timestamps) {
      result.lines.push({ time, text });
    }
  }

  // Сортируем по времени
  result.lines.sort((a, b) => a.time - b.time);

  // Вычисляем endTime для каждой строки
  for (let i = 0; i < result.lines.length; i++) {
    result.lines[i].endTime = result.lines[i + 1]?.time ?? result.lines[i].time + 5;
  }

  // Применяем offset если есть
  if (result.meta.offset) {
    const offsetMs = parseInt(result.meta.offset, 10) || 0;
    const offsetSec = offsetMs / 1000;
    for (const line of result.lines) {
      line.time = Math.max(0, line.time + offsetSec);
      line.endTime = Math.max(0, line.endTime + offsetSec);
    }
  }

  return result;
}

module.exports = { parse };
