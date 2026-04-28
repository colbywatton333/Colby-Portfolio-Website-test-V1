import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 3000;

const MIME = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

const server = http.createServer((req, res) => {
  // ── API: save project layouts ──
  if (req.method === 'POST' && req.url === '/api/layouts') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { projectId, layout } = JSON.parse(body);
        const layoutsPath = path.join(__dirname, 'content', 'layouts.json');
        let layouts = {};
        try { layouts = JSON.parse(fs.readFileSync(layoutsPath, 'utf8')); } catch {}
        layouts[projectId] = layout;
        fs.writeFileSync(layoutsPath, JSON.stringify(layouts, null, 2));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // ── API: create new project ──
  if (req.method === 'POST' && req.url === '/api/projects') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { title, year, categories, description, materials, process } = JSON.parse(body);
        if (!title) throw new Error('Title is required');
        const id = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
        const projPath = path.join(__dirname, 'content', 'projects.json');
        const data = JSON.parse(fs.readFileSync(projPath, 'utf8'));
        if (data.projects.find(p => p.id === id)) throw new Error('Project ID already exists');
        const project = { id, categories: categories || [], title, year: year || new Date().getFullYear(), description: description || '', materials: materials || '', process: process || '', images: [] };
        data.projects.push(project);
        fs.writeFileSync(projPath, JSON.stringify(data, null, 2));
        // Create image directory
        const imgDir = path.join(__dirname, 'IMAGES', id.toUpperCase());
        if (!fs.existsSync(imgDir)) fs.mkdirSync(imgDir, { recursive: true });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, project }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // ── API: delete project ──
  if (req.method === 'DELETE' && req.url.startsWith('/api/projects/')) {
    const projId = decodeURIComponent(req.url.slice('/api/projects/'.length));
    try {
      const projPath = path.join(__dirname, 'content', 'projects.json');
      const data = JSON.parse(fs.readFileSync(projPath, 'utf8'));
      const idx = data.projects.findIndex(p => p.id === projId);
      if (idx === -1) throw new Error('Project not found');
      data.projects.splice(idx, 1);
      fs.writeFileSync(projPath, JSON.stringify(data, null, 2));
      // Remove from layouts.json if present
      const layoutsPath = path.join(__dirname, 'content', 'layouts.json');
      try {
        const layouts = JSON.parse(fs.readFileSync(layoutsPath, 'utf8'));
        if (layouts[projId]) {
          delete layouts[projId];
          fs.writeFileSync(layoutsPath, JSON.stringify(layouts, null, 2));
        }
      } catch {}
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // ── API: update project metadata ──
  if (req.method === 'PUT' && req.url.startsWith('/api/projects/')) {
    const projId = decodeURIComponent(req.url.slice('/api/projects/'.length));
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const updates = JSON.parse(body);
        const projPath = path.join(__dirname, 'content', 'projects.json');
        const data = JSON.parse(fs.readFileSync(projPath, 'utf8'));
        const proj = data.projects.find(p => p.id === projId);
        if (!proj) throw new Error('Project not found');
        ['title', 'year', 'categories', 'client', 'sector', 'description', 'materials', 'process'].forEach(k => {
          if (updates[k] !== undefined) proj[k] = updates[k];
        });
        fs.writeFileSync(projPath, JSON.stringify(data, null, 2));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, project: proj }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // ── API: upload image to project (base64 in JSON) ──
  if (req.method === 'POST' && req.url.match(/^\/api\/projects\/[^/]+\/images$/)) {
    const projId = decodeURIComponent(req.url.split('/')[3]);
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { filename, data: b64data } = JSON.parse(body);
        if (!filename || !b64data) throw new Error('filename and data required');
        const imgDir = path.join(__dirname, 'IMAGES', projId.toUpperCase());
        if (!fs.existsSync(imgDir)) fs.mkdirSync(imgDir, { recursive: true });
        const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
        const filePath = path.join(imgDir, safeName);
        const buffer = Buffer.from(b64data, 'base64');
        fs.writeFileSync(filePath, buffer);
        const relativePath = 'IMAGES/' + projId.toUpperCase() + '/' + safeName;
        // Add to projects.json images array
        const projPath = path.join(__dirname, 'content', 'projects.json');
        const projData = JSON.parse(fs.readFileSync(projPath, 'utf8'));
        const proj = projData.projects.find(p => p.id === projId);
        if (proj) {
          if (!proj.images) proj.images = [];
          proj.images.push([relativePath]);
          fs.writeFileSync(projPath, JSON.stringify(projData, null, 2));
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, path: relativePath }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // ── API: upload about image ──
  if (req.method === 'POST' && req.url === '/api/about/upload') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { filename, data: b64data } = JSON.parse(body);
        if (!filename || !b64data) throw new Error('filename and data required');
        const imgDir = path.join(__dirname, 'IMAGES', 'ABOUT');
        if (!fs.existsSync(imgDir)) fs.mkdirSync(imgDir, { recursive: true });
        const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
        const filePath = path.join(imgDir, safeName);
        fs.writeFileSync(filePath, Buffer.from(b64data, 'base64'));
        const relativePath = 'IMAGES/ABOUT/' + safeName;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, path: relativePath }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // ── API: upload archive image ──
  if (req.method === 'POST' && req.url === '/api/archive/upload') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { filename, data: b64data } = JSON.parse(body);
        if (!filename || !b64data) throw new Error('filename and data required');
        const imgDir = path.join(__dirname, 'IMAGES', 'ARCHIVE');
        if (!fs.existsSync(imgDir)) fs.mkdirSync(imgDir, { recursive: true });
        const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
        const filePath = path.join(imgDir, safeName);
        fs.writeFileSync(filePath, Buffer.from(b64data, 'base64'));
        const relativePath = 'IMAGES/ARCHIVE/' + safeName;
        // Update archive.json
        const archivePath = path.join(__dirname, 'content', 'archive.json');
        let archiveData = { images: [] };
        try { archiveData = JSON.parse(fs.readFileSync(archivePath, 'utf8')); } catch {}
        archiveData.images.push({ src: relativePath, title: '', description: '' });
        fs.writeFileSync(archivePath, JSON.stringify(archiveData, null, 2));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, path: relativePath }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // ── API: save archive metadata ──
  if (req.method === 'POST' && req.url === '/api/archive') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const archiveData = JSON.parse(body);
        const archivePath = path.join(__dirname, 'content', 'archive.json');
        fs.writeFileSync(archivePath, JSON.stringify(archiveData, null, 2));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // ── API: save about page content ──
  if (req.method === 'POST' && req.url === '/api/about') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const aboutData = JSON.parse(body);
        const aboutPath = path.join(__dirname, 'content', 'about.json');
        fs.writeFileSync(aboutPath, JSON.stringify(aboutData, null, 2));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // ── API: list MP3s in MUSIC/ folder for the Player page ──
  if (req.method === 'GET' && req.url === '/api/music') {
    const dir = path.join(__dirname, 'MUSIC');
    let tracks = [];
    try {
      tracks = fs.readdirSync(dir)
        .filter(f => f.toLowerCase().endsWith('.mp3'))
        .sort()
        .slice(0, 15)
        .map(f => ({
          name: f.replace(/\.mp3$/i, '').replace(/[_-]+/g, ' '),
          src: 'MUSIC/' + encodeURIComponent(f),
          sizeBytes: fs.statSync(path.join(dir, f)).size,
        }));
    } catch {}
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
    res.end(JSON.stringify({ tracks }));
    return;
  }

  // ── Static file serving ──
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';

  const filePath = path.join(__dirname, urlPath);

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
