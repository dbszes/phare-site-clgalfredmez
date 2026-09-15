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

// Connexion des ordinateurs
io.on("connection", (socket) => {
  console.log("PC connecté :", socket.id);

  // Le PC indique s'il est administrateur
  socket.on("role", (role) => {
    socket.data.role = role;
    console.log(`${socket.id} → rôle : ${role}`);
  });

  // Réception d'un signalement
  socket.on("nouveau_signalement", (signalement) => {
    console.log("🚨 Nouveau signalement :", signalement);

    // Envoie le signalement à tous les administrateurs
    io.sockets.sockets.forEach((client) => {
      if (client.data.role === "admin") {
        client.emit("signalement_recu", signalement);
      }
    });
  });

  socket.on("disconnect", () => {
    console.log("PC déconnecté :", socket.id);
  });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, "0.0.0.0", () => {
  console.log(`🚨 Serveur PHARE démarré sur le port ${PORT}`);
});
