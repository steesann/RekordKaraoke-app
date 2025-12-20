const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const LinkBridge = require('./link-bridge');
const Resolver = require('./lyrics/resolver');
const logger = require('./util/logger');

// Загружаем конфиг
const configPath = path.join(__dirname, '../../config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

// Текущее состояние для клиентов
let currentState = {
  artist: '',
  title: '',
  time: 0,
  bpm: 0,
  lyrics: null,      // { lines: [...], meta: {...} }
  lyricsStatus: 'none' // none | loading | found | not_found
};

// WebSocket клиенты
const wsClients = new Set();

function broadcast(data) {
  const msg = JSON.stringify(data);
  for (const ws of wsClients) {
    if (ws.readyState === 1) { // OPEN
      ws.send(msg);
    }
  }
}

async function main() {
  // Инициализируем resolver
  const resolver = new Resolver(config);
  await resolver.init();

  // HTTP сервер для статики
  const server = http.createServer((req, res) => {
    let filePath = path.join(__dirname, '../public', req.url === '/' ? 'index.html' : req.url);
    
    const ext = path.extname(filePath);
    const mimeTypes = {
      '.html': 'text/html',
      '.js': 'text/javascript',
      '.css': 'text/css',
      '.json': 'application/json'
    };

    fs.readFile(filePath, (err, content) => {
      if (err) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'text/plain' });
      res.end(content);
    });
  });

  // WebSocket сервер
  const wss = new WebSocketServer({ server });
  
  wss.on('connection', (ws) => {
    logger.info('Client connected');
    wsClients.add(ws);
    
    // Отправляем текущее состояние
    ws.send(JSON.stringify({ type: 'state', data: currentState }));
    
    ws.on('close', () => {
      wsClients.delete(ws);
      logger.info('Client disconnected');
    });
  });

  // Link Bridge (OSC от rkbx_link)
  const bridge = new LinkBridge(config.osc);
  
  bridge.on('trackChanged', async ({ artist, title }) => {
    currentState.artist = artist;
    currentState.title = title;
    currentState.lyrics = null;
    currentState.lyricsStatus = 'loading';
    
    broadcast({ type: 'track', data: { artist, title, status: 'loading' } });
    
    // Ищем лирику
    const result = await resolver.resolve(artist, title);
    
    if (result) {
      // Загружаем JSON
      try {
        const lyrics = await resolver.store.load(result.jsonPath);
        currentState.lyrics = lyrics;
        currentState.lyricsStatus = 'found';
        broadcast({ type: 'lyrics', data: { status: 'found', lyrics } });
      } catch (err) {
        logger.error(`Failed to load lyrics: ${err.message}`);
        currentState.lyricsStatus = 'not_found';
        broadcast({ type: 'lyrics', data: { status: 'not_found' } });
      }
    } else {
      currentState.lyricsStatus = 'not_found';
      broadcast({ type: 'lyrics', data: { status: 'not_found' } });
    }
  });

  bridge.on('time', (time) => {
    currentState.time = time;
    broadcast({ type: 'time', data: time });
  });

  bridge.on('bpm', (bpm) => {
    currentState.bpm = bpm;
    broadcast({ type: 'bpm', data: bpm });
  });

  bridge.start();

  // Запускаем HTTP сервер
  const port = config.server.httpPort || 3000;
  server.listen(port, () => {
    logger.info(`Server running on http://localhost:${port}`);
    logger.info('Waiting for OSC from rkbx_link...');
  });
}

main().catch(err => {
  logger.error(err);
  process.exit(1);
});
