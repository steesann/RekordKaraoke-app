const fs = require('fs');
const path = require('path');
const LrclibProvider = require('./providers/lrclib');
const Store = require('./store');
const { getLibrary } = require('./library');
const { makeSafeFilename } = require('../util/normalize');
const parsers = require('../parsers');
const logger = require('../util/logger');

class Resolver {
  constructor(config) {
    this.config = config;
    this.providers = [];
    this.store = new Store({
      lyricsRaw: config.paths.lyricsRaw,
      lyricsJson: config.paths.lyricsJson
    });
    this.library = null;
    this.rawDir = config.paths.lyricsRaw;

    // Инициализируем провайдеры
    if (config.providers.lrclib?.enabled) {
      this.providers.push(new LrclibProvider(config.providers.lrclib));
    }
    // Можно добавить lyricsify и другие
  }

  async init() {
    await this.store.init();
    this.library = await getLibrary(this.config.paths.library);
  }

  /**
   * Ищет лирику: сначала локально, потом через провайдеры
   * Возвращает { jsonPath, ... } или null
   */
  async resolve(artist, title, options = {}) {
    const { skipLocal = false, skipProviders = false } = options;

    // 1. Проверяем library
    if (!skipLocal) {
      const cached = this.library.find(artist, title);
      if (cached) {
        logger.debug(`Library hit: "${artist} - ${title}"`);
        return cached;
      }
    }

    // 2. Проверяем локальные файлы в raw директории
    if (!skipLocal) {
      const localResult = await this.checkLocalFiles(artist, title);
      if (localResult) {
        return localResult;
      }
    }

    // 3. Запрашиваем провайдеры
    if (!skipProviders) {
      for (const provider of this.providers) {
        logger.debug(`Trying provider: ${provider.name}`);
        
        const result = await provider.search(artist, title);
        if (result) {
          logger.info(`Found via ${provider.name}: "${artist} - ${title}"`);
          
          // Сохраняем
          const stored = await this.store.save(artist, title, result.content, result.format);
          
          // Добавляем в library
          await this.library.add(artist, title, {
            ...stored,
            provider: provider.name
          });

          return this.library.find(artist, title);
        }
      }
    }

    logger.warn(`Not found: "${artist} - ${title}"`);
    return null;
  }

  /**
   * Проверяет наличие локальных файлов в raw директории
   */
  async checkLocalFiles(artist, title) {
    const baseName = makeSafeFilename(artist, title);
    const formats = parsers.getSupportedFormats();

    for (const ext of formats) {
      const rawPath = path.join(this.rawDir, `${baseName}${ext}`);
      
      try {
        await fs.promises.access(rawPath);
        
        // Файл существует, парсим и сохраняем
        logger.info(`Found local file: ${rawPath}`);
        const content = await fs.promises.readFile(rawPath, 'utf8');
        const stored = await this.store.save(artist, title, content, ext);
        
        await this.library.add(artist, title, {
          ...stored,
          provider: 'local'
        });

        return this.library.find(artist, title);
      } catch {
        // Файл не существует, продолжаем
      }
    }

    return null;
  }
}

module.exports = Resolver;
