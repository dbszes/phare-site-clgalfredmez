const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*"
  }
});

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.json({
    nom: "PHARE",
    statut: "Serveur opérationnel"
  });
});

io.on("connection", (socket) => {
  console.log("PC connecté :", socket.id);

  socket.on("disconnect", () => {
    console.log("PC déconnecté :", socket.id);
  });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, "0.0.0.0", () => {
  console.log(`🚨 Serveur PHARE démarré sur le port ${PORT}`);
});
