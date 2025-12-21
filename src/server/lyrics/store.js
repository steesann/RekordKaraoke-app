const fs = require('fs');
const path = require('path');
const { writeJsonAtomic } = require('../util/fs_atomic');
const { makeSafeFilename } = require('../util/normalize');
const parsers = require('../parsers');
const logger = require('../util/logger');

class Store {
  constructor(config) {
    this.rawDir = config.lyricsRaw;
    this.jsonDir = config.lyricsJson;
  }

  async init() {
    await fs.promises.mkdir(this.rawDir, { recursive: true });
    await fs.promises.mkdir(this.jsonDir, { recursive: true });
  }

  /**
   * Сохраняет raw файл, парсит, сохраняет JSON
   * @param {string} artist 
   * @param {string} title 
   * @param {string} rawContent 
   * @param {string} format 
   * @param {number} [duration] - длительность трека в секундах (для endTime последней строки)
   * @returns {{ rawPath, jsonPath, format, linesCount }}
   */
  async save(artist, title, rawContent, format, duration = null) {
    const baseName = makeSafeFilename(artist, title);
    
    // Сохраняем raw
    const rawExt = format.startsWith('.') ? format : `.${format}`;
    const rawPath = path.join(this.rawDir, `${baseName}${rawExt}`);
    await fs.promises.writeFile(rawPath, rawContent, 'utf8');
    logger.debug(`Saved raw: ${rawPath}`);

    // Парсим (передаём duration)
    const parsed = parsers.parse(rawContent, format, { duration });
    
    // Добавляем мета
    parsed.artist = artist;
    parsed.title = title;
    parsed.format = format;
    if (duration) parsed.duration = duration;

    // Сохраняем JSON
    const jsonPath = path.join(this.jsonDir, `${baseName}.json`);
    await writeJsonAtomic(jsonPath, parsed);
    logger.debug(`Saved json: ${jsonPath}`);

    return {
      rawPath: path.relative(process.cwd(), rawPath),
      jsonPath: path.relative(process.cwd(), jsonPath),
      format,
      linesCount: parsed.lines.length
    };
  }

  /**
   * Загружает JSON для рендера
   */
  async load(jsonPath) {
    const content = await fs.promises.readFile(jsonPath, 'utf8');
    return JSON.parse(content);
  }
}

module.exports = Store;
