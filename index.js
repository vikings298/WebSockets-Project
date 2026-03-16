const http = require("http");
const WebSocket = require("ws");

const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("WebSocket server is running");
});
const wss = new WebSocket.Server({ server });

wss.on("connection", (ws) => {
  console.log("Client connected");

  ws.send("Hello from server");

  ws.on("message", (message) => {
    console.log("Received:", message.toString());
    ws.send(`Server received: ${message}`);
  });

  ws.on("close", () => {
    console.log("Client disconnected");
  });
});

const PORT = 8080;
server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
