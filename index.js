const express = require("express");
const bodyParser = require("body-parser");
const { google } = require("googleapis");
const nodemailer = require("nodemailer");

const app = express();
app.use(bodyParser.json());

const PORT = process.env.PORT || 8080;

// Legge le credenziali dal Secret Manager (variabile d'ambiente)
function getCredentials() {
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
    throw new Error("La variabile d'ambiente GOOGLE_APPLICATION_CREDENTIALS_JSON non è impostata");
  }
  return JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
}

// Endpoint di test per Make.com
app.post("/preventivo", async (req, res) => {
  try {
    const data = req.body;
    console.log("Ricevuto preventivo:", data);

    const credentials = getCredentials();

    // Configura Nodemailer con OAuth2 dalle credenziali
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        type: "OAuth2",
        user: credentials.client_email,       // email del service account
        clientId: credentials.client_id,
        clientSecret: credentials.private_key, // alcune volte serve private_key invece di clientSecret
        refreshToken: credentials.refresh_token // se presente nel JSON
      }
    });

    await transporter.sendMail({
      from: credentials.client_email,
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
