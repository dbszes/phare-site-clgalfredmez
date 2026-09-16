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


// ===============================
// INITIALISATION BASE DE DONNÉES
// ===============================

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

    console.error(
      "❌ Erreur base de données :",
      error
    );

    throw error;
  }
}


// ===============================
// PAGE D'ACCUEIL
// ===============================

app.get("/", (req, res) => {

  res.json({
    nom: "PHARE",
    statut: "Serveur opérationnel",
    database: "connectée"
  });

});


// ===============================
// UTILISATEURS CONNECTÉS
// ===============================

function broadcastConnectedUsers() {

  const users = [];

  io.sockets.sockets.forEach((client) => {

    if (
      !client.data.firstName ||
      !client.data.lastName
    ) {
      return;
    }

    users.push({
      id: client.id,
      firstName: client.data.firstName,
      lastName: client.data.lastName,
      role: client.data.role || "user"
    });

  });


  // Envoyer uniquement aux administrateurs

  io.sockets.sockets.forEach((client) => {

    if (client.data.role === "admin") {

      client.emit(
        "utilisateurs_connectes",
        users
      );

    }

  });


  console.log(
    `👥 ${users.length} personne(s) connectée(s)`
  );

}


// ===============================
// SOCKET.IO
// ===============================

io.on("connection", (socket) => {

  console.log(
    "🟢 PC connecté :",
    socket.id
  );


  // ===============================
  // RÔLE + IDENTITÉ
  // ===============================

  socket.on("role", async (data) => {

    /*
      Compatible avec l'ancien format :

      socket.emit("role", "admin")

      et avec le nouveau :

      socket.emit("role", {
        role: "admin",
        firstName: "Ziyad",
        lastName: "HAMIED"
      })
    */

    const role =
      typeof data === "string"
        ? data
        : data?.role;


    const firstName =
      typeof data === "object"
        ? data.firstName
        : "";


    const lastName =
      typeof data === "object"
        ? data.lastName
        : "";


    socket.data.role =
      role || "user";

    socket.data.firstName =
      firstName || "";

    socket.data.lastName =
      lastName || "";


    console.log(
      `👤 ${socket.id} → ${socket.data.firstName} ${socket.data.lastName} → rôle : ${socket.data.role}`
    );


    // ===============================
    // HISTORIQUE ADMIN
    // ===============================

    if (socket.data.role === "admin") {

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


        socket.emit(
          "historique_signalements",
          result.rows
        );


        console.log(
          `📋 ${result.rows.length} signalement(s) envoyé(s) à l'admin`
        );


      } catch (error) {

        console.error(
          "❌ Erreur historique :",
          error
        );

      }

    }


    // Actualiser les personnes connectées

    broadcastConnectedUsers();

  });


  // ===============================
  // NOUVEAU SIGNALEMENT
  // ===============================

  socket.on(
    "nouveau_signalement",
    async (signalement, callback) => {

      console.log(
        "🚨 NOUVEAU SIGNALEMENT REÇU"
      );

      console.log(
        "ID :",
        signalement?.id
      );


      try {

        if (
          !signalement ||
          !signalement.id
        ) {

          throw new Error(
            "Signalement ou ID manquant."
          );

        }


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


        console.log(
          "💾 Signalement sauvegardé dans PostgreSQL"
        );


        // Envoyer aux administrateurs

        io.sockets.sockets.forEach(
          (client) => {

            if (
              client.data.role === "admin"
            ) {

              client.emit(
                "signalement_recu",
                signalement
              );

            }

          }
        );


        console.log(
          "⚡ Signalement envoyé aux admins"
        );


        // ACK pour le navigateur

        if (
          typeof callback === "function"
        ) {

          callback({
            success: true,
            message:
              "Signalement enregistré."
          });

        }


      } catch (error) {

        console.error(
          "❌ Erreur sauvegarde :",
          error
        );


        socket.emit(
          "erreur_signalement",
          {
            message:
              "Impossible d'enregistrer le signalement."
          }
        );


        if (
          typeof callback === "function"
        ) {

          callback({
            success: false,
            message:
              "Impossible d'enregistrer le signalement."
          });

        }

      }

    }
  );


  // ===============================
  // SUPPRESSION
  // ===============================

  socket.on(
    "supprimer_signalement",
    async (id, callback) => {

      console.log(
        "================================="
      );

      console.log(
        "🗑️ DEMANDE DE SUPPRESSION REÇUE"
      );

      console.log(
        "Socket :",
        socket.id
      );

      console.log(
        "Rôle :",
        socket.data.role
      );

      console.log(
        "ID reçu :",
        id
      );

      console.log(
        "Type ID :",
        typeof id
      );

      console.log(
        "================================="
      );


      // ===============================
      // VÉRIFICATION ADMIN
      // ===============================

      if (
        socket.data.role !== "admin"
      ) {

        console.log(
          "🚫 SUPPRESSION REFUSÉE : utilisateur non admin"
        );


        socket.emit(
          "erreur_signalement",
          {
            message:
              "Action non autorisée."
          }
        );


        if (
          typeof callback === "function"
        ) {

          callback({
            success: false,
            message:
              "Action non autorisée."
          });

        }

        return;
      }


      // ===============================
      // VÉRIFICATION ID
      // ===============================

      if (!id) {

        console.log(
          "❌ SUPPRESSION REFUSÉE : ID manquant"
        );


        socket.emit(
          "erreur_signalement",
          {
            message:
              "Identifiant du signalement manquant."
          }
        );


        if (
          typeof callback === "function"
        ) {

          callback({
            success: false,
            message:
              "Identifiant manquant."
          });

        }

        return;
      }


      try {

        const result =
          await pool.query(
            `
            DELETE FROM signalements
            WHERE id = $1
            RETURNING id
            `,
            [String(id)]
          );


        // ===============================
        // INTROUVABLE
        // ===============================

        if (
          result.rowCount === 0
        ) {

          console.log(
            "⚠️ Signalement introuvable dans PostgreSQL :",
            id
          );


          socket.emit(
            "erreur_signalement",
            {
              message:
                "Signalement introuvable."
            }
          );


          if (
            typeof callback === "function"
          ) {

            callback({
              success: false,
              message:
                "Signalement introuvable."
            });

          }

          return;
        }


        // ===============================
        // SUPPRESSION RÉUSSIE
        // ===============================

        const deletedId =
          result.rows[0].id;


        console.log(
          "✅ Signalement supprimé de PostgreSQL :",
          deletedId
        );


        // Informer tous les admins

        io.sockets.sockets.forEach(
          (client) => {

            if (
              client.data.role === "admin"
            ) {

              client.emit(
                "signalement_supprime",
                deletedId
              );

            }

          }
        );


        console.log(
          "⚡ Confirmation de suppression envoyée aux admins"
        );


        // ACK

        if (
          typeof callback === "function"
        ) {

          callback({
            success: true,
            id: deletedId,
            message:
              "Signalement supprimé définitivement."
          });

        }


      } catch (error) {

        console.error(
          "❌ ERREUR PostgreSQL SUPPRESSION :",
          error
        );


        socket.emit(
          "erreur_signalement",
          {
            message:
              "Impossible de supprimer le signalement."
          }
        );


        if (
          typeof callback === "function"
        ) {

          callback({
            success: false,
            message:
              "Erreur lors de la suppression."
          });

        }

      }

    }
  );


  // ===============================
  // DÉCONNEXION
  // ===============================

  socket.on("disconnect", () => {

    console.log(
      "🔴 PC déconnecté :",
      socket.id
    );


    // Actualiser la liste des connectés

    broadcastConnectedUsers();

  });

});


// ===============================
// DÉMARRAGE DU SERVEUR
// ===============================

const PORT =
  process.env.PORT || 3000;


async function startServer() {

  try {

    await initDatabase();


    server.listen(
      PORT,
      "0.0.0.0",
      () => {

        console.log(
          `🚨 Serveur PHARE démarré sur le port ${PORT}`
        );

      }
    );


  } catch (error) {

    console.error(
      "❌ Impossible de démarrer PHARE :",
      error
    );


    process.exit(1);

  }

}


startServer();
