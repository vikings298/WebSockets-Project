const http = require("http");
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");

const server = http.createServer((req, res) => {
  if (req.url === "/") {
    const filePath = path.join(__dirname, "public", "index.html");

    fs.readFile(filePath, (err, content) => {
      if (err) {
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end("Error loading page");
        return;
      }

      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(content);
    });

    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not found");
});

const wss = new WebSocket.Server({ server });

const rooms = new Map();
const clientNames = new Map();
const clientRooms = new Map();

function generateRoomCode() {
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let code = "";

  for (let i = 0; i < 4; i++) {
    code += letters[Math.floor(Math.random() * letters.length)];
  }

  return code;
}

function createUniqueRoomCode() {
  let code = generateRoomCode();

  while (rooms.has(code)) {
    code = generateRoomCode();
  }

  return code;
}

function sendToClient(ws, messageObject) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(messageObject));
  }
}

function broadcastToRoom(roomCode, messageObject) {
  const room = rooms.get(roomCode);

  if (!room) return;

  const messageString = JSON.stringify(messageObject);

  room.players.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(messageString);
    }
  });
}

function broadcastPlayerList(roomCode) {
  const room = rooms.get(roomCode);
  if (!room) return;

  const playerNames = room.players.map((client) => clientNames.get(client));

  broadcastToRoom(roomCode, {
    type: "players",
    players: playerNames,
    host: clientNames.get(room.host),
    roomCode: roomCode,
  });
}

function removeClientFromRoom(ws) {
  const roomCode = clientRooms.get(ws);
  if (!roomCode) return;

  const room = rooms.get(roomCode);

  if (!room) {
    clientRooms.delete(ws);
    return;
  }

  const playerName = clientNames.get(ws) || "Unknown Player";

  room.players = room.players.filter((client) => client !== ws);

  clientRooms.delete(ws);

  if (room.players.length === 0) {
    rooms.delete(roomCode);
    console.log(`Room ${roomCode} deleted`);
    return;
  }

  if (room.host === ws) {
    room.host = room.players[0];

    broadcastToRoom(roomCode, {
      type: "system",
      text: `${playerName} left. ${clientNames.get(room.host)} is now host.`,
    });
  } else {
    broadcastToRoom(roomCode, {
      type: "system",
      text: `${playerName} left the room.`,
    });
  }

  broadcastPlayerList(roomCode);
}

wss.on("connection", (ws) => {
  console.log("Client connected");

  ws.on("message", (message) => {
    let data;

    try {
      data = JSON.parse(message.toString());
    } catch {
      console.log("Invalid JSON received");
      return;
    }

    /* CREATE ROOM */
    if (data.type === "create_room") {
      const name = data.name?.trim();

      if (!name) {
        sendToClient(ws, {
          type: "error",
          text: "Name required",
        });
        return;
      }

      removeClientFromRoom(ws);

      const roomCode = createUniqueRoomCode();

      clientNames.set(ws, name);
      clientRooms.set(ws, roomCode);

      rooms.set(roomCode, {
        code: roomCode,
        host: ws,
        players: [ws],
      });

      console.log(`${name} created room ${roomCode}`);
      console.log("Rooms now:", Array.from(rooms.keys()));

      sendToClient(ws, {
        type: "room_created",
        roomCode: roomCode,
      });

      broadcastToRoom(roomCode, {
        type: "system",
        text: `${name} created the room`,
      });

      broadcastPlayerList(roomCode);
      return;
    }

    /* JOIN ROOM */
    if (data.type === "join_room") {
      const name = data.name?.trim();
      const roomCode = data.code?.trim().toUpperCase();

      console.log("Join attempt:", roomCode);
      console.log("Rooms available:", Array.from(rooms.keys()));

      if (!name || !roomCode) {
        sendToClient(ws, {
          type: "error",
          text: "Name and room code required",
        });
        return;
      }

      const room = rooms.get(roomCode);

      if (!room) {
        sendToClient(ws, {
          type: "error",
          text: "Room not found",
        });
        return;
      }

      removeClientFromRoom(ws);

      clientNames.set(ws, name);
      clientRooms.set(ws, roomCode);
      room.players.push(ws);

      console.log(`${name} joined room ${roomCode}`);

      sendToClient(ws, {
        type: "room_joined",
        roomCode: roomCode,
      });

      broadcastToRoom(roomCode, {
        type: "system",
        text: `${name} joined the room`,
      });

      broadcastPlayerList(roomCode);
      return;
    }

    /* CHAT */
    if (data.type === "chat") {
      const roomCode = clientRooms.get(ws);
      const playerName = clientNames.get(ws);

      if (!roomCode || !playerName) {
        sendToClient(ws, {
          type: "error",
          text: "Join a room first",
        });
        return;
      }

      const text = data.text?.trim();
      if (!text) return;

      console.log(`[${roomCode}] ${playerName}: ${text}`);

      broadcastToRoom(roomCode, {
        type: "chat",
        name: playerName,
        text: text,
      });
    }
  });

  ws.on("close", () => {
    const playerName = clientNames.get(ws) || "Unknown Player";

    console.log(`${playerName} disconnected`);

    removeClientFromRoom(ws);
    clientNames.delete(ws);
  });
});

const PORT = 8080;

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
