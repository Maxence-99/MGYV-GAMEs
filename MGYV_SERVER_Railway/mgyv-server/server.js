const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const rateLimit = require('express-rate-limit');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'mgyv_secret_railway_2025';

// ── DIRS ──
['uploads/games', 'uploads/covers', 'data'].forEach(d => {
  fs.mkdirSync(path.join(__dirname, d), { recursive: true });
});

// ── MIDDLEWARE ──
app.use(cors({
  origin: true,
  credentials: true,
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization','Cookie']
}));
app.use(express.json());
app.use(cookieParser());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 500, standardHeaders: true });
app.use('/api/auth', limiter);

// ── AUTH MIDDLEWARE ──
function authMiddleware(req, res, next) {
  const token = req.cookies?.token || req.headers?.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Non connecté' });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Session invalide' }); }
}
function adminMiddleware(req, res, next) {
  authMiddleware(req, res, () => {
    if (!req.user.isAdmin) return res.status(403).json({ error: 'Accès admin requis' });
    next();
  });
}

// ── MULTER ──
const coverStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, 'uploads/covers')),
  filename: (req, file, cb) => cb(null, Date.now() + '_' + file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_'))
});
const gameStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, 'uploads/games')),
  filename: (req, file, cb) => cb(null, Date.now() + '_' + file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_'))
});
const uploadCover = multer({ storage: coverStorage, limits: { fileSize: 10 * 1024 * 1024 } });
const uploadGame  = multer({ storage: gameStorage,  limits: { fileSize: 50 * 1024 * 1024 * 1024 } });

// ── AUTH ──
app.post('/api/auth/register', async (req, res) => {
  const { username, email, password } = req.body;
  if (!username || !email || !password) return res.status(400).json({ error: 'Champs manquants' });
  if (password.length < 6) return res.status(400).json({ error: 'Mot de passe trop court (min 6 caractères)' });
  if (db.getUserByEmail(email)) return res.status(409).json({ error: 'Email déjà utilisé' });
  const hash = await bcrypt.hash(password, 10);
  const isAdmin = db.getUsers().length === 0; // premier = admin
  const user = db.createUser({ username, email, password: hash, isAdmin });
  const token = jwt.sign({ id: user.id, username: user.username, email: user.email, isAdmin: user.isAdmin }, JWT_SECRET, { expiresIn: '30d' });
  res.cookie('token', token, { httpOnly: true, maxAge: 30 * 24 * 3600 * 1000, sameSite: 'none', secure: true });
  res.json({ token, user: { id: user.id, username: user.username, email: user.email, isAdmin: user.isAdmin } });
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Champs manquants' });
  const user = db.getUserByEmail(email);
  if (!user) return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
  const ok = await bcrypt.compare(password, user.password);
  if (!ok) return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
  const token = jwt.sign({ id: user.id, username: user.username, email: user.email, isAdmin: user.isAdmin }, JWT_SECRET, { expiresIn: '30d' });
  res.cookie('token', token, { httpOnly: true, maxAge: 30 * 24 * 3600 * 1000, sameSite: 'none', secure: true });
  res.json({ token, user: { id: user.id, username: user.username, email: user.email, isAdmin: user.isAdmin } });
});

app.post('/api/auth/logout', (req, res) => { res.clearCookie('token'); res.json({ ok: true }); });

app.get('/api/auth/me', authMiddleware, (req, res) => {
  const user = db.getUserById(req.user.id);
  if (!user) return res.status(404).json({ error: 'Introuvable' });
  res.json({ id: user.id, username: user.username, email: user.email, isAdmin: user.isAdmin, createdAt: user.createdAt });
});

// ── GAMES ──
app.get('/api/games', (req, res) => {
  res.json(db.getGames().map(g => ({
    id: g.id, name: g.name, genre: g.genre, description: g.description,
    status: g.status, progress: g.progress, coverUrl: g.coverUrl,
    hasFile: !!g.fileName, downloads: g.downloads, createdAt: g.createdAt
  })));
});

app.post('/api/games', adminMiddleware, uploadCover.single('cover'), (req, res) => {
  const { name, genre, description, status, progress } = req.body;
  if (!name) return res.status(400).json({ error: 'Nom requis' });
  const coverUrl = req.file ? `/uploads/covers/${req.file.filename}` : null;
  res.json(db.createGame({ name, genre, description, status: status || 'available', progress: parseInt(progress) || 0, coverUrl }));
});

app.post('/api/games/:id/file', adminMiddleware, uploadGame.single('gameFile'), (req, res) => {
  const id = parseInt(req.params.id);
  const game = db.getGameById(id);
  if (!game) return res.status(404).json({ error: 'Jeu introuvable' });
  if (!req.file) return res.status(400).json({ error: 'Aucun fichier' });
  if (game.fileName) {
    const old = path.join(__dirname, 'uploads/games', game.fileName);
    if (fs.existsSync(old)) fs.unlinkSync(old);
  }
  db.updateGame(id, { fileName: req.file.filename, fileOriginalName: req.file.originalname, fileSize: req.file.size });
  res.json({ ok: true });
});

app.delete('/api/games/:id', adminMiddleware, (req, res) => {
  const id = parseInt(req.params.id);
  const game = db.getGameById(id);
  if (!game) return res.status(404).json({ error: 'Introuvable' });
  if (game.fileName) { const fp = path.join(__dirname, 'uploads/games', game.fileName); if (fs.existsSync(fp)) fs.unlinkSync(fp); }
  if (game.coverUrl) { const cp = path.join(__dirname, game.coverUrl.replace(/^\//, '')); if (fs.existsSync(cp)) fs.unlinkSync(cp); }
  db.deleteGame(id);
  res.json({ ok: true });
});

app.get('/api/games/:id/download', authMiddleware, (req, res) => {
  const id = parseInt(req.params.id);
  const game = db.getGameById(id);
  if (!game || !game.fileName) return res.status(404).json({ error: 'Fichier non disponible' });
  const filePath = path.join(__dirname, 'uploads/games', game.fileName);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Fichier manquant' });
  db.incrementDownloads(id);
  db.logDownload(req.user.id, id);
  res.download(filePath, game.fileOriginalName || game.fileName);
});

app.patch('/api/games/:id', adminMiddleware, uploadCover.single('cover'), (req, res) => {
  const id = parseInt(req.params.id);
  if (!db.getGameById(id)) return res.status(404).json({ error: 'Introuvable' });
  const u = {};
  if (req.body.name) u.name = req.body.name;
  if (req.body.genre) u.genre = req.body.genre;
  if (req.body.description !== undefined) u.description = req.body.description;
  if (req.body.status) u.status = req.body.status;
  if (req.body.progress !== undefined) u.progress = parseInt(req.body.progress);
  if (req.file) u.coverUrl = `/uploads/covers/${req.file.filename}`;
  res.json(db.updateGame(id, u));
});

// ── ADMIN ──
app.get('/api/admin/stats', adminMiddleware, (req, res) => {
  const users = db.getUsers(); const games = db.getGames();
  res.json({ totalUsers: users.length, totalGames: games.length, totalDownloads: games.reduce((s,g)=>s+(g.downloads||0),0), availableGames: games.filter(g=>g.status==='available').length });
});

app.get('/api/admin/users', adminMiddleware, (req, res) => {
  res.json(db.getUsers().map(u => ({ id: u.id, username: u.username, email: u.email, isAdmin: u.isAdmin, createdAt: u.createdAt })));
});

app.patch('/api/admin/users/:id/promote', adminMiddleware, (req, res) => {
  const u = db.updateUser(parseInt(req.params.id), { isAdmin: true });
  if (!u) return res.status(404).json({ error: 'Introuvable' });
  res.json({ ok: true });
});

// ── HEALTH CHECK ──
app.get('/', (req, res) => res.json({ status: 'ok', app: 'MGYV GAMEs Server', version: '1.0.0' }));

app.listen(PORT, () => console.log(`🎮 MGYV GAMEs Server — port ${PORT}`));
