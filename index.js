const express = require("express");
const bodyParser = require("body-parser");
const fs = require("fs");
const { google } = require("googleapis");
const nodemailer = require("nodemailer");

const app = express();
app.use(bodyParser.json());

const PORT = process.env.PORT || 8080;

// Funzione per leggere credenziali
function getCredentials() {
  const path = "./credentials/noleggio-auto-backend.json"; // il JSON in locale
  return JSON.parse(fs.readFileSync(path));
}

// Endpoint di test
app.post("/preventivo", async (req, res) => {
  try {
    const data = req.body;
    console.log("Ricevuto preventivo:", data);
    
    // Esempio: invio email con Nodemailer
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        type: "OAuth2",
        user: "tua-email@gmail.com",
        clientId: "CLIENT_ID_DA_CREDENTIALS",
        clientSecret: "CLIENT_SECRET_DA_CREDENTIALS",
        refreshToken: "REFRESH_TOKEN_DA_CREDENTIALS"
      }
    });

    await transporter.sendMail({
      from: "tua-email@gmail.com",
      to: data.email,
      subject: "Conferma preventivo",
      text: `Ciao ${data["nome-cognome"]}, abbiamo ricevuto il tuo preventivo!`
    });

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.listen(PORT, () => console.log(`Server in ascolto sulla porta ${PORT}`));
