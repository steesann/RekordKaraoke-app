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
   * Возвращает { rawPath, jsonPath, format }
   */
  async save(artist, title, rawContent, format) {
    const baseName = makeSafeFilename(artist, title);
    
    // Сохраняем raw
    const rawExt = format.startsWith('.') ? format : `.${format}`;
    const rawPath = path.join(this.rawDir, `${baseName}${rawExt}`);
    await fs.promises.writeFile(rawPath, rawContent, 'utf8');
    logger.debug(`Saved raw: ${rawPath}`);

    // Парсим
    const parsed = parsers.parse(rawContent, format);
    
    // Добавляем мета
    parsed.artist = artist;
    parsed.title = title;
    parsed.format = format;

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
