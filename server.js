const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const { Pool } = require("pg");
const crypto = require("crypto");

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


// ======================================================
// BASE DE DONNÉES
// ======================================================

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});


// ======================================================
// SÉCURITÉ
// ======================================================

// IMPORTANT : sur Render, ajoute une variable d'environnement
// SESSION_SECRET avec une longue valeur aléatoire.
//
// Si elle n'existe pas, le serveur utilise une valeur temporaire.
// Pour la production, il faut absolument définir SESSION_SECRET.

const SESSION_SECRET =
  process.env.SESSION_SECRET ||
  crypto.randomBytes(32).toString("hex");


// ======================================================
// OUTILS MOT DE PASSE
// ======================================================

function hashPassword(password) {
  return new Promise((resolve, reject) => {

    const salt = crypto.randomBytes(16).toString("hex");

    crypto.scrypt(
      password,
      salt,
      64,
      (error, derivedKey) => {

        if (error) {
          reject(error);
          return;
        }

        resolve(
          `${salt}:${derivedKey.toString("hex")}`
        );

      }
    );

  });
}


function verifyPassword(password, storedHash) {
  return new Promise((resolve, reject) => {

    try {

      const parts = storedHash.split(":");

      if (parts.length !== 2) {
        resolve(false);
        return;
      }

      const salt = parts[0];
      const storedKey = Buffer.from(parts[1], "hex");

      crypto.scrypt(
        password,
        salt,
        64,
        (error, derivedKey) => {

          if (error) {
            reject(error);
            return;
          }

          if (derivedKey.length !== storedKey.length) {
            resolve(false);
            return;
          }

          resolve(
            crypto.timingSafeEqual(
              derivedKey,
              storedKey
            )
          );

        }
      );

    } catch (error) {

      reject(error);

    }

  });
}


// ======================================================
// SESSION
// ======================================================

function createToken(user) {

  const payload = {
    id: user.id,
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    role: user.role,
    exp: Date.now() + (7 * 24 * 60 * 60 * 1000)
  };

  const encodedPayload =
    Buffer
      .from(JSON.stringify(payload))
      .toString("base64url");

  const signature =
    crypto
      .createHmac("sha256", SESSION_SECRET)
      .update(encodedPayload)
      .digest("base64url");

  return `${encodedPayload}.${signature}`;
}


function verifyToken(token) {

  try {

    if (!token || typeof token !== "string") {
      return null;
    }

    const parts = token.split(".");

    if (parts.length !== 2) {
      return null;
    }

    const payloadPart = parts[0];
    const signature = parts[1];

    const expectedSignature =
      crypto
        .createHmac("sha256", SESSION_SECRET)
        .update(payloadPart)
        .digest("base64url");

    const a = Buffer.from(signature);
    const b = Buffer.from(expectedSignature);

    if (
      a.length !== b.length ||
      !crypto.timingSafeEqual(a, b)
    ) {
      return null;
    }

    const payload =
      JSON.parse(
        Buffer
          .from(payloadPart, "base64url")
          .toString("utf8")
      );

    if (
      !payload.exp ||
      Date.now() > payload.exp
    ) {
      return null;
    }

    return payload;

  } catch (error) {

    return null;

  }

}


// ======================================================
// AUTHENTIFICATION HTTP
// ======================================================

function normalizeEmail(email) {

  return String(email || "")
    .trim()
    .toLowerCase();

}


function normalizeName(name) {

  return String(name || "")
    .trim();

}


// ======================================================
// INITIALISATION BASE DE DONNÉES
// ======================================================

async function initDatabase() {

  try {

    // -------------------------------
    // TABLE UTILISATEURS
    // -------------------------------

    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        first_name TEXT NOT NULL,
        last_name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'user',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);


    // -------------------------------
    // TABLE SIGNALEMENTS
    // -------------------------------

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


    // ==================================================
    // CRÉATION AUTOMATIQUE DU COMPTE ADMIN
    // ==================================================

    /*
      Dans Render, ajoute :

      ADMIN_FIRST_NAME
      ADMIN_LAST_NAME
      ADMIN_EMAIL
      ADMIN_PASSWORD

      Exemple :

      ADMIN_FIRST_NAME = Ziyad
      ADMIN_LAST_NAME = HAMIED
      ADMIN_EMAIL = ton-email@example.com
      ADMIN_PASSWORD = ton-mot-de-passe

      Le mot de passe sera automatiquement hashé.
    */

    const adminEmail =
      normalizeEmail(process.env.ADMIN_EMAIL);

    const adminPassword =
      process.env.ADMIN_PASSWORD;

    const adminFirstName =
      normalizeName(
        process.env.ADMIN_FIRST_NAME || "Ziyad"
      );

    const adminLastName =
      normalizeName(
        process.env.ADMIN_LAST_NAME || "HAMIED"
      );


    if (adminEmail && adminPassword) {

      const existingAdmin =
        await pool.query(
          `
          SELECT id
          FROM users
          WHERE email = $1
          LIMIT 1
          `,
          [adminEmail]
        );


      if (existingAdmin.rowCount === 0) {

        const passwordHash =
          await hashPassword(adminPassword);

        await pool.query(
          `
          INSERT INTO users (
            id,
            first_name,
            last_name,
            email,
            password_hash,
            role
          )
          VALUES ($1,$2,$3,$4,$5,$6)
          `,
          [
            crypto.randomUUID(),
            adminFirstName,
            adminLastName,
            adminEmail,
            passwordHash,
            "admin"
          ]
        );

        console.log(
          "👑 Compte administrateur créé."
        );

      } else {

        console.log(
          "👑 Compte administrateur déjà présent."
        );

      }

    } else {

      console.log(
        "⚠️ ADMIN_EMAIL / ADMIN_PASSWORD non configurés."
      );

    }


    console.log(
      "✅ Base de données PHARE prête"
    );

  } catch (error) {

    console.error(
      "❌ Erreur base de données :",
      error
    );

    throw error;

  }

}


// ======================================================
// PAGE D'ACCUEIL
// ======================================================

app.get("/", (req, res) => {

  res.json({
    nom: "PHARE",
    statut: "Serveur opérationnel",
    database: "connectée"
  });

});


// ======================================================
// INSCRIPTION
// ======================================================

app.post("/api/auth/register", async (req, res) => {

  try {

    const firstName =
      normalizeName(req.body.firstName);

    const lastName =
      normalizeName(req.body.lastName);

    const email =
      normalizeEmail(req.body.email);

    const password =
      String(req.body.password || "");


    if (
      !firstName ||
      !lastName ||
      !email ||
      !password
    ) {

      return res.status(400).json({
        success: false,
        message:
          "Tous les champs sont obligatoires."
      });

    }


    if (password.length < 8) {

      return res.status(400).json({
        success: false,
        message:
          "Le mot de passe doit contenir au moins 8 caractères."
      });

    }


    const existing =
      await pool.query(
        `
        SELECT id
        FROM users
        WHERE email = $1
        LIMIT 1
        `,
        [email]
      );


    if (existing.rowCount > 0) {

      return res.status(409).json({
        success: false,
        message:
          "Cette adresse e-mail est déjà utilisée."
      });

    }


    const passwordHash =
      await hashPassword(password);


    const id =
      crypto.randomUUID();


    await pool.query(
      `
      INSERT INTO users (
        id,
        first_name,
        last_name,
        email,
        password_hash,
        role
      )
      VALUES ($1,$2,$3,$4,$5,$6)
      `,
      [
        id,
        firstName,
        lastName,
        email,
        passwordHash,
        "user"
      ]
    );


    return res.json({
      success: true,
      message:
        "Compte créé avec succès."
    });


  } catch (error) {

    console.error(
      "❌ Erreur inscription :",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Impossible de créer le compte."
    });

  }

});


// ======================================================
// CONNEXION
// ======================================================

app.post("/api/auth/login", async (req, res) => {

  try {

    const firstName =
      normalizeName(req.body.firstName);

    const lastName =
      normalizeName(req.body.lastName);

    const email =
      normalizeEmail(req.body.email);

    const password =
      String(req.body.password || "");


    if (
      !firstName ||
      !lastName ||
      !email ||
      !password
    ) {

      return res.status(400).json({
        success: false,
        message:
          "Prénom, nom, e-mail et mot de passe sont obligatoires."
      });

    }


    const result =
      await pool.query(
        `
        SELECT
          id,
          first_name AS "firstName",
          last_name AS "lastName",
          email,
          password_hash AS "passwordHash",
          role
        FROM users
        WHERE email = $1
        LIMIT 1
        `,
        [email]
      );


    if (result.rowCount === 0) {

      return res.status(401).json({
        success: false,
        message:
          "E-mail ou mot de passe incorrect."
      });

    }


    const user =
      result.rows[0];


    // Vérification prénom / nom

    if (
      user.firstName.toLowerCase() !==
        firstName.toLowerCase() ||
      user.lastName.toLowerCase() !==
        lastName.toLowerCase()
    ) {

      return res.status(401).json({
        success: false,
        message:
          "Les informations personnelles ne correspondent pas à ce compte."
      });

    }


    const validPassword =
      await verifyPassword(
        password,
        user.passwordHash
      );


    if (!validPassword) {

      return res.status(401).json({
        success: false,
        message:
          "E-mail ou mot de passe incorrect."
      });

    }


    const token =
      createToken({
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        role: user.role
      });


    console.log(
      `🔐 Connexion : ${user.firstName} ${user.lastName} (${user.email}) → ${user.role}`
    );


    return res.json({
      success: true,

      token,

      user: {
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        role: user.role
      }
    });


  } catch (error) {

    console.error(
      "❌ Erreur connexion :",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Erreur lors de la connexion."
    });

  }

});


// ======================================================
// VÉRIFICATION SESSION
// ======================================================

app.get("/api/auth/me", (req, res) => {

  const header =
    req.headers.authorization || "";

  const token =
    header.startsWith("Bearer ")
      ? header.substring(7)
      : null;

  const user =
    verifyToken(token);


  if (!user) {

    return res.status(401).json({
      success: false,
      message: "Session invalide ou expirée."
    });

  }


  return res.json({
    success: true,
    user
  });

});


// ======================================================
// UTILISATEURS CONNECTÉS
// ======================================================

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


// ======================================================
// SOCKET.IO
// ======================================================

io.on("connection", (socket) => {

  console.log(
    "🟢 Connexion Socket.IO :",
    socket.id
  );


  // ====================================================
  // AUTHENTIFICATION SOCKET
  // ====================================================

  const token =
    socket.handshake.auth?.token;

  const user =
    verifyToken(token);


  if (!user) {

    console.log(
      "🚫 Socket refusé : session invalide"
    );

    socket.emit(
      "auth_error",
      {
        message:
          "Session invalide ou expirée."
      }
    );

    socket.disconnect(true);

    return;

  }


  socket.data.userId =
    user.id;

  socket.data.firstName =
    user.firstName;

  socket.data.lastName =
    user.lastName;

  socket.data.email =
    user.email;

  socket.data.role =
    user.role;


  console.log(
    `👤 ${socket.id} → ${user.firstName} ${user.lastName} → ${user.role}`
  );


  // ====================================================
  // HISTORIQUE ADMIN
  // ====================================================

  if (socket.data.role === "admin") {

    pool.query(`
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
    `)
    .then((result) => {

      socket.emit(
        "historique_signalements",
        result.rows
      );

      console.log(
        `📋 ${result.rows.length} signalement(s) envoyé(s) à l'admin`
      );

    })
    .catch((error) => {

      console.error(
        "❌ Erreur historique :",
        error
      );

    });

  }


  broadcastConnectedUsers();


  // ====================================================
  // NOUVEAU SIGNALEMENT
  // ====================================================

  socket.on(
    "nouveau_signalement",
    async (signalement, callback) => {

      try {

        if (
          !signalement ||
          !signalement.id
        ) {

          throw new Error(
            "Signalement ou ID manquant."
          );

        }


        // L'auteur vient maintenant
        // de la session authentifiée.

        const safeSignalement = {

          id: String(signalement.id),

          firstName:
            String(signalement.firstName || "").trim(),

          lastName:
            String(signalement.lastName || "").trim(),

          type:
            String(signalement.type || "").trim(),

          duration:
            String(signalement.duration || "").trim(),

          description:
            String(signalement.description || "").trim(),

          authorFirstName:
            socket.data.firstName,

          authorLastName:
            socket.data.lastName,

          date:
            signalement.date ||
            new Date().toLocaleString("fr-FR")

        };


        if (
          !safeSignalement.firstName ||
          !safeSignalement.lastName ||
          !safeSignalement.type ||
          !safeSignalement.description
        ) {

          throw new Error(
            "Informations du signalement incomplètes."
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
            safeSignalement.id,
            safeSignalement.firstName,
            safeSignalement.lastName,
            safeSignalement.type,
            safeSignalement.duration,
            safeSignalement.description,
            safeSignalement.authorFirstName,
            safeSignalement.authorLastName
          ]
        );


        console.log(
          "💾 Signalement sauvegardé dans PostgreSQL"
        );


        // Envoyer uniquement aux admins

        io.sockets.sockets.forEach(
          (client) => {

            if (
              client.data.role === "admin"
            ) {

              client.emit(
                "signalement_recu",
                safeSignalement
              );

            }

          }
        );


        if (
          typeof callback === "function"
        ) {

          callback({
            success: true,
            message:
              "Signalement enregistré.",
            signalement:
              safeSignalement
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


  // ====================================================
  // SUPPRESSION
  // ====================================================

  socket.on(
    "supprimer_signalement",
    async (id, callback) => {

      console.log(
        "🗑️ DEMANDE DE SUPPRESSION :",
        id
      );


      // Vérification serveur

      if (
        socket.data.role !== "admin"
      ) {

        console.log(
          "🚫 Suppression refusée : non-admin"
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


      if (!id) {

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


        if (
          result.rowCount === 0
        ) {

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


        const deletedId =
          result.rows[0].id;


        console.log(
          "✅ Signalement supprimé :",
          deletedId
        );


        // Informer les admins

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
          "❌ Erreur suppression :",
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


  // ====================================================
  // DÉCONNEXION
  // ====================================================

  socket.on("disconnect", () => {

    console.log(
      "🔴 Socket déconnecté :",
      socket.id
    );

    broadcastConnectedUsers();

  });

});


// ======================================================
// DÉMARRAGE
// ======================================================

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
