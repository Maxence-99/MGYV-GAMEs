const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'data', 'db.json');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

function load() {
  if (!fs.existsSync(DB_PATH)) {
    const init = { users: [], games: [], downloads: [] };
    fs.writeFileSync(DB_PATH, JSON.stringify(init, null, 2));
    return init;
  }
  try { return JSON.parse(fs.readFileSync(DB_PATH, 'utf8')); }
  catch { return { users: [], games: [], downloads: [] }; }
}

function save(db) { fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2)); }
function nextId(arr) { return arr.length === 0 ? 1 : Math.max(...arr.map(r => r.id)) + 1; }

module.exports = {
  getUsers: () => load().users,
  getUserByEmail: (email) => load().users.find(u => u.email === email),
  getUserById: (id) => load().users.find(u => u.id === id),
  createUser(data) {
    const db = load();
    const user = { id: nextId(db.users), ...data, createdAt: new Date().toISOString() };
    db.users.push(user); save(db); return user;
  },
  updateUser(id, data) {
    const db = load();
    const i = db.users.findIndex(u => u.id === id);
    if (i === -1) return null;
    db.users[i] = { ...db.users[i], ...data }; save(db); return db.users[i];
  },
  getGames: () => load().games,
  getGameById: (id) => load().games.find(g => g.id === id),
  createGame(data) {
    const db = load();
    const game = { id: nextId(db.games), ...data, createdAt: new Date().toISOString(), downloads: 0 };
    db.games.push(game); save(db); return game;
  },
  updateGame(id, data) {
    const db = load();
    const i = db.games.findIndex(g => g.id === id);
    if (i === -1) return null;
    db.games[i] = { ...db.games[i], ...data }; save(db); return db.games[i];
  },
  deleteGame(id) {
    const db = load();
    db.games = db.games.filter(g => g.id !== id); save(db);
  },
  incrementDownloads(id) {
    const db = load();
    const i = db.games.findIndex(g => g.id === id);
    if (i !== -1) { db.games[i].downloads = (db.games[i].downloads || 0) + 1; save(db); }
  },
  logDownload(userId, gameId) {
    const db = load();
    db.downloads.push({ userId, gameId, at: new Date().toISOString() }); save(db);
  }
};
