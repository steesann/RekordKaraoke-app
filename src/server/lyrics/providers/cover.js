/**
 * Cover Art Provider
 * Использует iTunes Search API для поиска обложек
 */

const fs = require('fs');
const path = require('path');
const logger = require('../util/logger');
const { cleanForSearch, makeSafeFilename } = require('../util/normalize');

class CoverProvider {
  constructor(config) {
    this.coversDir = config.paths?.covers || './data/covers';
    this.timeout = config.timeout || 5000;
  }

  async init() {
    await fs.promises.mkdir(this.coversDir, { recursive: true });
  }

  /**
   * Получает путь к обложке (из кэша или скачивает)
   * @returns {string|null} относительный путь к файлу или null
   */
  async getCover(artist, title) {
    const filename = `${makeSafeFilename(artist, title)}.jpg`;
    const filePath = path.join(this.coversDir, filename);

    // Проверяем кэш
    try {
      await fs.promises.access(filePath);
      logger.debug(`Cover cache hit: ${filename}`);
      return `/covers/${filename}`;
    } catch {
      // Не в кэше, ищем
    }

    // Поиск через iTunes
    const coverUrl = await this.searchItunes(artist, title);
    if (!coverUrl) {
      // Пробуем очищенный запрос
      const cleanArtist = cleanForSearch(artist);
      const cleanTitle = cleanForSearch(title);
      if (cleanArtist !== artist || cleanTitle !== title) {
        const fallbackUrl = await this.searchItunes(cleanArtist, cleanTitle);
        if (fallbackUrl) {
          await this.downloadCover(fallbackUrl, filePath);
          return `/covers/${filename}`;
        }
      }
      return null;
    }

    // Скачиваем
    await this.downloadCover(coverUrl, filePath);
    return `/covers/${filename}`;
  }

  /**
   * Поиск обложки через iTunes Search API
   */
  async searchItunes(artist, title) {
    const query = encodeURIComponent(`${artist} ${title}`);
    const url = `https://itunes.apple.com/search?term=${query}&media=music&entity=song&limit=5`;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'RekordKaraoke/1.0'
        }
      });
      clearTimeout(timeoutId);

      if (!res.ok) {
        logger.warn(`iTunes API error: ${res.status}`);
        return null;
      }

      const data = await res.json();
      if (!data.results || data.results.length === 0) {
        logger.debug(`iTunes: no results for "${artist} - ${title}"`);
        return null;
      }

      // Берём первый результат и увеличиваем размер обложки
      // iTunes отдаёт 100x100 по умолчанию, меняем на 600x600
      const artwork = data.results[0].artworkUrl100;
      if (!artwork) return null;

      const highResArtwork = artwork.replace('100x100bb', '600x600bb');
      logger.debug(`iTunes: found cover for "${artist} - ${title}"`);
      return highResArtwork;

    } catch (err) {
      if (err.name === 'AbortError') {
        logger.warn(`iTunes timeout for "${artist} - ${title}"`);
      } else {
        logger.error(`iTunes error: ${err.message}`);
      }
      return null;
    }
  }

  /**
   * Скачивает обложку и сохраняет в файл
   */
  async downloadCover(url, filePath) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (!res.ok) {
        logger.warn(`Failed to download cover: ${res.status}`);
        return false;
      }

      const buffer = await res.arrayBuffer();
      await fs.promises.writeFile(filePath, Buffer.from(buffer));
      logger.info(`Downloaded cover: ${path.basename(filePath)}`);
      return true;

    } catch (err) {
      logger.error(`Cover download error: ${err.message}`);
      return false;
    }
  }

  /**
   * Проверяет есть ли обложка в кэше
   */
  async hasCover(artist, title) {
    const filename = `${makeSafeFilename(artist, title)}.jpg`;
    const filePath = path.join(this.coversDir, filename);
    try {
      await fs.promises.access(filePath);
      return true;
    } catch {
      return false;
    }
  }
}

module.exports = CoverProvider;
