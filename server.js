const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve static files
app.use(express.static(path.join(__dirname, "public")));

// In-memory storage
const messages = [];
const users = {};
const rooms = {
  geral:            { name: "💬 Geral",                        group: "geral",    messages: [] },
  resumos:          { name: "📝 Resumos Gerais",               group: "geral",    messages: [] },
  portugues:        { name: "🇧🇷 Língua Portuguesa",           group: "linguagens", messages: [] },
  ingles:           { name: "🇺🇸 Língua Inglesa",              group: "linguagens", messages: [] },
  raciocinio:       { name: "🧮 Raciocínio Lógico-Matemático", group: "exatas",   messages: [] },
  estatistica:      { name: "📊 Estatística",                  group: "exatas",   messages: [] },
  fluencia_dados:   { name: "🗃️ Fluência em Dados",            group: "exatas",   messages: [] },
  economia:         { name: "💰 Economia e Finanças Públicas", group: "adm",      messages: [] },
  adm_geral:        { name: "🏢 Administração Geral",          group: "adm",      messages: [] },
  adm_publica:      { name: "🏛️ Administração Pública",        group: "adm",      messages: [] },
  auditoria:        { name: "🔍 Auditoria",                    group: "adm",      messages: [] },
  contabilidade:    { name: "📒 Contabilidade Geral e Pública", group: "adm",     messages: [] },
  dir_administrativo: { name: "⚖️ Direito Administrativo",    group: "direito",  messages: [] },
  dir_constitucional: { name: "📜 Direito Constitucional",    group: "direito",  messages: [] },
  dir_previdenciario: { name: "👴 Direito Previdenciário",     group: "direito",  messages: [] },
  dir_tributario:   { name: "🧾 Direito Tributário",           group: "direito",  messages: [] },
  leg_tributaria:   { name: "📋 Legislação Tributária",        group: "direito",  messages: [] },
  comercio_int:     { name: "🌍 Comércio Internacional",       group: "aduaneiro", messages: [] },
  leg_aduaneira:    { name: "🛃 Legislação Aduaneira",         group: "aduaneiro", messages: [] },
};

io.on("connection", (socket) => {
  console.log("Novo usuário conectado:", socket.id);

  // Send room list on connect
  socket.emit("room_list", Object.entries(rooms).map(([id, r]) => ({ id, name: r.name, group: r.group })));

  // User joins with a name
  socket.on("join", ({ username, avatar }) => {
    users[socket.id] = { username, avatar, currentRoom: "geral" };
    socket.join("geral");

    // Send history of general room
    socket.emit("history", rooms["geral"].messages.slice(-50));

    // Notify room
    io.to("geral").emit("user_event", {
      type: "join",
      username,
      avatar,
      timestamp: Date.now(),
    });

    // Update user list
    io.emit("user_list", Object.values(users));
    console.log(`${username} entrou na sala geral`);
  });

  // Switch room
  socket.on("switch_room", (roomId) => {
    const user = users[socket.id];
    if (!user || !rooms[roomId]) return;

    const oldRoom = user.currentRoom;
    socket.leave(oldRoom);
    socket.join(roomId);
    user.currentRoom = roomId;

    // Send history
    socket.emit("history", rooms[roomId].messages.slice(-50));
    socket.emit("switched_room", { roomId, roomName: rooms[roomId].name });
  });

  // Message
  socket.on("message", ({ text, type, roomId }) => {
    const user = users[socket.id];
    if (!user) return;

    const msg = {
      id: Date.now() + Math.random(),
      username: user.username,
      avatar: user.avatar,
      text,
      type: type || "text", // text | resumo | dica | duvida
      roomId,
      timestamp: Date.now(),
    };

    if (rooms[roomId]) {
      rooms[roomId].messages.push(msg);
      // Keep last 200 messages per room
      if (rooms[roomId].messages.length > 200) {
        rooms[roomId].messages.shift();
      }
    }

    io.to(roomId).emit("message", msg);
  });

  // Typing indicator
  socket.on("typing", ({ roomId, isTyping }) => {
    const user = users[socket.id];
    if (!user) return;
    socket.to(roomId).emit("typing", { username: user.username, isTyping });
  });

  // Disconnect
  socket.on("disconnect", () => {
    const user = users[socket.id];
    if (user) {
      io.emit("user_event", {
        type: "leave",
        username: user.username,
        timestamp: Date.now(),
      });
      delete users[socket.id];
      io.emit("user_list", Object.values(users));
      console.log(`${user.username} desconectou`);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`\n✅ StudyChat rodando!`);
  console.log(`📡 Acesse: http://localhost:${PORT}`);
  console.log(`📡 Na rede: http://[SEU-IP-LOCAL]:${PORT}`);
  console.log(`\nDica: Para ver seu IP local, rode: ipconfig (Windows) ou ip a (Linux)\n`);
});
