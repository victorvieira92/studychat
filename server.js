const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: false });
const JWT_SECRET = process.env.JWT_SECRET || "studychat_secret_2024";

app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      avatar TEXT NOT NULL DEFAULT '👨‍💻',
      created_at BIGINT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS messages (
      id SERIAL PRIMARY KEY,
      room_id TEXT NOT NULL,
      username TEXT NOT NULL,
      avatar TEXT NOT NULL,
      text TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'text',
      timestamp BIGINT NOT NULL
    );
  `);

  // Create default users if they don't exist
  const users = [
    { username: process.env.USER1_NAME || "usuario1", password: process.env.USER1_PASS || "senha1", avatar: "👨‍💻" },
    { username: process.env.USER2_NAME || "usuario2", password: process.env.USER2_PASS || "senha2", avatar: "👩‍💻" },
  ];

  for (const u of users) {
    const name = u.username.toLowerCase().trim();
    const hash = await bcrypt.hash(u.password.trim(), 10);
    const exists = await pool.query("SELECT id FROM users WHERE username = $1", [name]);
    if (exists.rows.length === 0) {
      await pool.query(
        "INSERT INTO users (username, password, avatar, created_at) VALUES ($1, $2, $3, $4)",
        [name, hash, u.avatar, Date.now()]
      );
      console.log(`✅ Usuário criado: ${name}`);
    } else {
      await pool.query("UPDATE users SET password = $1 WHERE username = $2", [hash, name]);
      console.log(`✅ Senha atualizada: ${name}`);
    }
  }
  console.log("✅ Banco de dados pronto!");
}

// ── AUTH ROUTES ──
app.post("/api/login", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: "Preencha todos os campos" });

  console.log(`Login tentativa: "${username}" / "${password}"`);
  const result = await pool.query("SELECT * FROM users WHERE username = $1", [username.toLowerCase()]);
  console.log(`Usuários encontrados: ${result.rows.length}`);
  if (result.rows.length === 0) return res.status(401).json({ error: "Usuário ou senha incorretos" });
  const user = result.rows[0];
  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return res.status(401).json({ error: "Usuário ou senha incorretos" });

  const token = jwt.sign({ id: user.id, username: user.username, avatar: user.avatar }, JWT_SECRET, { expiresIn: "30d" });
  res.cookie("token", token, { httpOnly: true, maxAge: 30 * 24 * 60 * 60 * 1000 });
  res.json({ ok: true, username: user.username, avatar: user.avatar });
});

app.post("/api/logout", (req, res) => {
  res.clearCookie("token");
  res.json({ ok: true });
});

app.get("/api/me", (req, res) => {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ error: "Não autenticado" });
  try {
    const user = jwt.verify(token, JWT_SECRET);
    res.json({ username: user.username, avatar: user.avatar });
  } catch {
    res.status(401).json({ error: "Token inválido" });
  }
});

// ── SOCKET AUTH ──
io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) return next(new Error("Não autenticado"));
  try {
    const user = jwt.verify(token, JWT_SECRET);
    socket.user = user;
    next();
  } catch {
    next(new Error("Token inválido"));
  }
});

const rooms = {
  geral:              { name: "💬 Geral",                         group: "geral" },
  resumos:            { name: "📝 Resumos Gerais",                group: "geral" },
  portugues:          { name: "🇧🇷 Língua Portuguesa",            group: "linguagens" },
  ingles:             { name: "🇺🇸 Língua Inglesa",               group: "linguagens" },
  raciocinio:         { name: "🧮 Raciocínio Lógico-Matemático",  group: "exatas" },
  estatistica:        { name: "📊 Estatística",                   group: "exatas" },
  fluencia_dados:     { name: "🗃️ Fluência em Dados",             group: "exatas" },
  economia:           { name: "💰 Economia e Finanças Públicas",  group: "adm" },
  adm_geral:          { name: "🏢 Administração Geral",           group: "adm" },
  adm_publica:        { name: "🏛️ Administração Pública",         group: "adm" },
  auditoria:          { name: "🔍 Auditoria",                     group: "adm" },
  contabilidade:      { name: "📒 Contabilidade Geral e Pública", group: "adm" },
  dir_administrativo: { name: "⚖️ Direito Administrativo",        group: "direito" },
  dir_constitucional: { name: "📜 Direito Constitucional",        group: "direito" },
  dir_previdenciario: { name: "👴 Direito Previdenciário",        group: "direito" },
  dir_tributario:     { name: "🧾 Direito Tributário",            group: "direito" },
  leg_tributaria:     { name: "📋 Legislação Tributária",         group: "direito" },
  comercio_int:       { name: "🌍 Comércio Internacional",        group: "aduaneiro" },
  leg_aduaneira:      { name: "🛃 Legislação Aduaneira",          group: "aduaneiro" },
};

const onlineUsers = {};

io.on("connection", async (socket) => {
  const { username, avatar } = socket.user;
  onlineUsers[socket.id] = { username, avatar, currentRoom: "geral" };
  socket.join("geral");

  socket.emit("room_list", Object.entries(rooms).map(([id, r]) => ({ id, name: r.name, group: r.group })));

  const result = await pool.query(
    "SELECT * FROM messages WHERE room_id = $1 ORDER BY timestamp ASC LIMIT 50", ["geral"]
  );
  socket.emit("history", result.rows.map(dbToMsg));

  io.to("geral").emit("user_event", { type: "join", username, avatar, timestamp: Date.now() });
  io.emit("user_list", Object.values(onlineUsers));

  socket.on("switch_room", async (roomId) => {
    if (!rooms[roomId]) return;
    socket.leave(onlineUsers[socket.id].currentRoom);
    socket.join(roomId);
    onlineUsers[socket.id].currentRoom = roomId;
    const r = await pool.query(
      "SELECT * FROM messages WHERE room_id = $1 ORDER BY timestamp ASC LIMIT 50", [roomId]
    );
    socket.emit("history", r.rows.map(dbToMsg));
    socket.emit("switched_room", { roomId, roomName: rooms[roomId].name });
  });

  socket.on("message", async ({ text, type, roomId }) => {
    if (!text || !rooms[roomId]) return;
    const r = await pool.query(
      "INSERT INTO messages (room_id, username, avatar, text, type, timestamp) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *",
      [roomId, username, avatar, text, type || "text", Date.now()]
    );
    io.to(roomId).emit("message", dbToMsg(r.rows[0]));
  });

  socket.on("typing", ({ roomId, isTyping }) => {
    socket.to(roomId).emit("typing", { username, isTyping });
  });

  socket.on("disconnect", () => {
    io.emit("user_event", { type: "leave", username, timestamp: Date.now() });
    delete onlineUsers[socket.id];
    io.emit("user_list", Object.values(onlineUsers));
  });
});

function dbToMsg(row) {
  return {
    id: row.id, roomId: row.room_id, username: row.username,
    avatar: row.avatar, text: row.text, type: row.type,
    timestamp: Number(row.timestamp),
  };
}

const PORT = process.env.PORT || 3000;
initDB().then(() => {
  server.listen(PORT, "0.0.0.0", () => console.log(`✅ StudyChat rodando na porta ${PORT}!`));
});
