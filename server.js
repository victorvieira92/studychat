const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const { Pool } = require("pg");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: false,
});

async function initDB() {
  await pool.query(`
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
  console.log("✅ Banco de dados pronto!");
}

app.use(express.static(path.join(__dirname, "public")));

const users = {};
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

io.on("connection", (socket) => {
  socket.emit("room_list", Object.entries(rooms).map(([id, r]) => ({ id, name: r.name, group: r.group })));

  socket.on("join", async ({ username, avatar }) => {
    users[socket.id] = { username, avatar, currentRoom: "geral" };
    socket.join("geral");
    const result = await pool.query(
      "SELECT * FROM messages WHERE room_id = $1 ORDER BY timestamp ASC LIMIT 50",
      ["geral"]
    );
    socket.emit("history", result.rows.map(dbToMsg));
    io.to("geral").emit("user_event", { type: "join", username, avatar, timestamp: Date.now() });
    io.emit("user_list", Object.values(users));
  });

  socket.on("switch_room", async (roomId) => {
    const user = users[socket.id];
    if (!user || !rooms[roomId]) return;
    socket.leave(user.currentRoom);
    socket.join(roomId);
    user.currentRoom = roomId;
    const result = await pool.query(
      "SELECT * FROM messages WHERE room_id = $1 ORDER BY timestamp ASC LIMIT 50",
      [roomId]
    );
    socket.emit("history", result.rows.map(dbToMsg));
    socket.emit("switched_room", { roomId, roomName: rooms[roomId].name });
  });

  socket.on("message", async ({ text, type, roomId }) => {
    const user = users[socket.id];
    if (!user) return;
    const result = await pool.query(
      "INSERT INTO messages (room_id, username, avatar, text, type, timestamp) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *",
      [roomId, user.username, user.avatar, text, type || "text", Date.now()]
    );
    io.to(roomId).emit("message", dbToMsg(result.rows[0]));
  });

  socket.on("typing", ({ roomId, isTyping }) => {
    const user = users[socket.id];
    if (!user) return;
    socket.to(roomId).emit("typing", { username: user.username, isTyping });
  });

  socket.on("disconnect", () => {
    const user = users[socket.id];
    if (user) {
      io.emit("user_event", { type: "leave", username: user.username, timestamp: Date.now() });
      delete users[socket.id];
      io.emit("user_list", Object.values(users));
    }
  });
});

function dbToMsg(row) {
  return {
    id: row.id,
    roomId: row.room_id,
    username: row.username,
    avatar: row.avatar,
    text: row.text,
    type: row.type,
    timestamp: Number(row.timestamp),
  };
}

const PORT = process.env.PORT || 3000;
initDB().then(() => {
  server.listen(PORT, "0.0.0.0", () => {
    console.log(`✅ StudyChat rodando na porta ${PORT}!`);
  });
});
