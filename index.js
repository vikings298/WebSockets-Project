const http = require("http");
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");

const server = http.createServer((req, res) => {

  if (req.url === "/") {
    const filePath = path.join(__dirname, "public", "index.html");

    fs.readFile(filePath, (err, content) => {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(content);
    });

    return;
  }

});

const wss = new WebSocket.Server({ server });

wss.on("connection", (ws) => {
  console.log("Client connected");

  ws.send("Connected to server");

  ws.on("message", (message) => {
    console.log("Received:", message.toString());
    ws.send("Server received: " + message);
  });

  ws.on("close", () => {
    console.log("Client disconnected");
  });
});

const PORT = 8080;

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
