const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const { Pool } = require("pg");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.json());

// ===============================
// BASE DE DONNÉES PHARE
// ===============================

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// Création automatique de la table
async function initDatabase() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS signalements (
        id TEXT PRIMARY KEY,
        first_name TEXT NOT NULL,
        last_name TEXT NOT NULL,
        type TEXT NOT NULL,
        duration TEXT,
        description TEXT NOT NULL,
        author_first_name TEXT,
        author_last_name TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    console.log("✅ Base de données PHARE prête");
  } catch (error) {
    console.error("❌ Erreur base de données :", error);
  }
}

initDatabase();

// ===============================
// PAGE D'ACCUEIL DU SERVEUR
// ===============================

app.get("/", (req, res) => {
  res.json({
    nom: "PHARE",
    statut: "Serveur opérationnel",
    database: "connectée"
  });
});

// ===============================
// SOCKET.IO
// ===============================

io.on("connection", async (socket) => {
  console.log("🟢 PC connecté :", socket.id);

  // -------------------------------
  // RÔLE DE L'UTILISATEUR
  // -------------------------------

  socket.on("role", async (role) => {
    socket.data.role = role;

    console.log(`${socket.id} → rôle : ${role}`);

    // Si c'est Ziyad/admin,
    // envoyer immédiatement l'historique
    if (role === "admin") {
      try {
        const result = await pool.query(`
          SELECT
            id,
            first_name AS "firstName",
            last_name AS "lastName",
            type,
            duration,
            description,
            author_first_name AS "authorFirstName",
            author_last_name AS "authorLastName",
            created_at AS "createdAt"
          FROM signalements
          ORDER BY created_at DESC
        `);

        socket.emit("historique_signalements", result.rows);

        console.log(
          `📋 ${result.rows.length} signalement(s) envoyé(s) à l'admin`
        );
      } catch (error) {
        console.error("❌ Erreur historique :", error);
      }
    }
  });

  // -------------------------------
  // NOUVEAU SIGNALEMENT
  // -------------------------------

  socket.on("nouveau_signalement", async (signalement) => {
    console.log("🚨 Nouveau signalement reçu :", signalement);

    try {
      await pool.query(
        `
        INSERT INTO signalements (
          id,
          first_name,
          last_name,
          type,
          duration,
          description,
          author_first_name,
          author_last_name
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        `,
        [
          signalement.id,
          signalement.firstName,
          signalement.lastName,
          signalement.type,
          signalement.duration,
          signalement.description,
          signalement.authorFirstName,
          signalement.authorLastName
        ]
      );

      console.log("💾 Signalement sauvegardé");

      // Envoyer immédiatement à tous les admins connectés
      io.sockets.sockets.forEach((client) => {
        if (client.data.role === "admin") {
          client.emit("signalement_recu", signalement);
        }
      });

      console.log("⚡ Signalement envoyé aux admins");
    } catch (error) {
      console.error("❌ Erreur sauvegarde :", error);

      socket.emit("erreur_signalement", {
        message: "Impossible d'enregistrer le signalement."
      });
    }
  });

  // -------------------------------
  // DÉCONNEXION
  // -------------------------------

  socket.on("disconnect", () => {
    console.log("🔴 PC déconnecté :", socket.id);
  });
});

// ===============================
// DÉMARRAGE
// ===============================

const PORT = process.env.PORT || 3000;

server.listen(PORT, "0.0.0.0", () => {
  console.log(`🚨 Serveur PHARE démarré sur le port ${PORT}`);
});
