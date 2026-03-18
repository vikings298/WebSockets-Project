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

const triviaQuestions = [
  {
    question: "What planet is known as the Red Planet?",
    answers: ["mars"],
  },
  {
    question: "How many sides does a hexagon have?",
    answers: ["6", "six"],
  },
  {
    question: "What is the capital of Nebraska?",
    answers: ["lincoln"],
  },
  {
    question: "What gas do humans breathe in to survive?",
    answers: ["oxygen"],
  },
  {
    question: "What is 9 + 10?",
    answers: ["19", "nineteen"],
  },
  {
    question: "What ocean is on the west coast of the United States?",
    answers: ["pacific", "pacific ocean"],
  },
  {
    question: "Who lives in a pineapple under the sea?",
    answers: ["spongebob", "spongebob squarepants"],
  },
  {
    question: "What is the largest planet in our solar system?",
    answers: ["jupiter"],
  },
];

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

function normalizeAnswer(answer) {
  return answer.trim().toLowerCase();
}

function getRandomQuestion() {
  return triviaQuestions[Math.floor(Math.random() * triviaQuestions.length)];
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

function getRoomState(roomCode) {
  const room = rooms.get(roomCode);
  if (!room) return null;

  return {
    code: room.code,
    players: room.players.map((client) => clientNames.get(client)),
    host: clientNames.get(room.host),
    game: {
      status: room.game.status,
      round: room.game.round,
      maxRounds: room.game.maxRounds,
      started: room.game.started,
      currentQuestion: room.game.currentQuestion,
      winner: room.game.winner,
      scoreboard: room.game.scoreboard,
    },
  };
}

function broadcastRoomState(roomCode) {
  const roomState = getRoomState(roomCode);
  if (!roomState) return;

  broadcastToRoom(roomCode, {
    type: "room_state",
    room: roomState,
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

function isHost(ws, room) {
  return room.host === ws;
}

function ensurePlayerHasScore(room, playerName) {
  if (room.game.scoreboard[playerName] === undefined) {
    room.game.scoreboard[playerName] = 0;
  }
}

function startRound(roomCode, roundNumber) {
  const room = rooms.get(roomCode);
  if (!room) return;

  const questionData = getRandomQuestion();

  room.game.status = "in_round";
  room.game.round = roundNumber;
  room.game.currentQuestion = questionData.question;
  room.game.acceptedAnswers = questionData.answers.map(normalizeAnswer);
  room.game.winner = null;

  broadcastToRoom(roomCode, {
    type: "system",
    text: `Round ${room.game.round} begins.`,
  });

  broadcastRoomState(roomCode);
}

function startGame(roomCode) {
  const room = rooms.get(roomCode);
  if (!room) return;

  room.game.started = true;
  startRound(roomCode, 1);
}

function nextRound(roomCode) {
  const room = rooms.get(roomCode);
  if (!room) return;

  if (!room.game.started) return;

  const nextRoundNumber = room.game.round + 1;

  if (nextRoundNumber > room.game.maxRounds) {
    room.game.status = "game_over";
    room.game.started = false;
    room.game.currentQuestion = null;
    room.game.acceptedAnswers = [];
    room.game.winner = null;

    broadcastToRoom(roomCode, {
      type: "system",
      text: "Game over!",
    });

    broadcastRoomState(roomCode);
    return;
  }

  startRound(roomCode, nextRoundNumber);
}

function endGame(roomCode) {
  const room = rooms.get(roomCode);
  if (!room) return;

  room.game.started = false;
  room.game.status = "game_over";
  room.game.currentQuestion = null;
  room.game.acceptedAnswers = [];
  room.game.winner = null;

  broadcastToRoom(roomCode, {
    type: "system",
    text: "The host ended the game.",
  });

  broadcastRoomState(roomCode);
}

function resetRoomToLobby(roomCode) {
  const room = rooms.get(roomCode);
  if (!room) return;

  room.game = {
    status: "lobby",
    round: 0,
    maxRounds: 5,
    started: false,
    currentQuestion: null,
    acceptedAnswers: [],
    winner: null,
    scoreboard: {},
  };

  room.players.forEach((client) => {
    const playerName = clientNames.get(client);
    if (playerName) {
      room.game.scoreboard[playerName] = 0;
    }
  });

  broadcastRoomState(roomCode);
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

  if (playerName in room.game.scoreboard) {
    delete room.game.scoreboard[playerName];
  }

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
  broadcastRoomState(roomCode);
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
        game: {
          status: "lobby",
          round: 0,
          maxRounds: 5,
          started: false,
          currentQuestion: null,
          acceptedAnswers: [],
          winner: null,
          scoreboard: {
            [name]: 0,
          },
        },
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
      broadcastRoomState(roomCode);
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
      ensurePlayerHasScore(room, name);

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
      broadcastRoomState(roomCode);
      return;
    }

    /* START GAME - HOST ONLY */
    if (data.type === "start_game") {
      const roomCode = clientRooms.get(ws);
      const room = rooms.get(roomCode);

      if (!roomCode || !room) {
        sendToClient(ws, {
          type: "error",
          text: "Join a room first",
        });
        return;
      }

      if (!isHost(ws, room)) {
        sendToClient(ws, {
          type: "error",
          text: "Only the host can start the game",
        });
        return;
      }

      if (room.players.length < 2) {
        sendToClient(ws, {
          type: "error",
          text: "Need at least 2 players to start",
        });
        return;
      }

      if (room.game.started) {
        sendToClient(ws, {
          type: "error",
          text: "Game already started",
        });
        return;
      }

      room.players.forEach((client) => {
        const playerName = clientNames.get(client);
        if (playerName) {
          room.game.scoreboard[playerName] = 0;
        }
      });

      startGame(roomCode);
      return;
    }

    /* NEXT ROUND - HOST ONLY */
    if (data.type === "next_round") {
      const roomCode = clientRooms.get(ws);
      const room = rooms.get(roomCode);

      if (!roomCode || !room) {
        sendToClient(ws, {
          type: "error",
          text: "Join a room first",
        });
        return;
      }

      if (!isHost(ws, room)) {
        sendToClient(ws, {
          type: "error",
          text: "Only the host can advance the round",
        });
        return;
      }

      if (!room.game.started) {
        sendToClient(ws, {
          type: "error",
          text: "Game has not started",
        });
        return;
      }

      if (room.game.status === "in_round") {
        sendToClient(ws, {
          type: "error",
          text: "This round is still active",
        });
        return;
      }

      nextRound(roomCode);
      return;
    }

    /* END GAME - HOST ONLY */
    if (data.type === "end_game") {
      const roomCode = clientRooms.get(ws);
      const room = rooms.get(roomCode);

      if (!roomCode || !room) {
        sendToClient(ws, {
          type: "error",
          text: "Join a room first",
        });
        return;
      }

      if (!isHost(ws, room)) {
        sendToClient(ws, {
          type: "error",
          text: "Only the host can end the game",
        });
        return;
      }

      endGame(roomCode);
      return;
    }

    /* RESET TO LOBBY - HOST ONLY */
    if (data.type === "reset_lobby") {
      const roomCode = clientRooms.get(ws);
      const room = rooms.get(roomCode);

      if (!roomCode || !room) {
        sendToClient(ws, {
          type: "error",
          text: "Join a room first",
        });
        return;
      }

      if (!isHost(ws, room)) {
        sendToClient(ws, {
          type: "error",
          text: "Only the host can reset the lobby",
        });
        return;
      }

      resetRoomToLobby(roomCode);

      broadcastToRoom(roomCode, {
        type: "system",
        text: "Room reset to lobby.",
      });

      return;
    }

    /* SUBMIT ANSWER */
    if (data.type === "submit_answer") {
      const roomCode = clientRooms.get(ws);
      const room = rooms.get(roomCode);
      const playerName = clientNames.get(ws);

      if (!roomCode || !room || !playerName) {
        sendToClient(ws, {
          type: "error",
          text: "Join a room first",
        });
        return;
      }

      if (!room.game.started || room.game.status !== "in_round") {
        sendToClient(ws, {
          type: "error",
          text: "No active round right now",
        });
        return;
      }

      const answer = data.answer?.trim();

      if (!answer) {
        sendToClient(ws, {
          type: "error",
          text: "Answer cannot be empty",
        });
        return;
      }

      const normalized = normalizeAnswer(answer);
      const isCorrect = room.game.acceptedAnswers.includes(normalized);

      if (!isCorrect) {
        sendToClient(ws, {
          type: "system",
          text: "Incorrect",
        });
        return;
      }

      if (room.game.winner) {
        sendToClient(ws, {
          type: "system",
          text: `Too late! ${room.game.winner} already won the round.`,
        });
        return;
      }

      room.game.winner = playerName;
      room.game.status = "round_end";
      room.game.scoreboard[playerName] = (room.game.scoreboard[playerName] || 0) + 1;

      broadcastToRoom(roomCode, {
        type: "system",
        text: `${playerName} answered correctly and wins the round!`,
      });

      broadcastToRoom(roomCode, {
        type: "system",
        text: `Correct answer: ${room.game.acceptedAnswers[0]}`,
      });

      broadcastRoomState(roomCode);
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

      return;
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
