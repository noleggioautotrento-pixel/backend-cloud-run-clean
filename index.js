// index.js - versione definitiva Cloud Run + Shared Drive + Gmail OAuth2

const express = require("express");
const bodyParser = require("body-parser");
const nodemailer = require("nodemailer");
const { google } = require("googleapis");

const app = express();
app.use(bodyParser.json());

const PORT = process.env.PORT || 8080;

/* =========================
   GMAIL OAuth2
========================= */
const oAuth2Client = new google.auth.OAuth2(
  process.env.GMAIL_CLIENT_ID,
  process.env.GMAIL_CLIENT_SECRET
);
oAuth2Client.setCredentials({
  refresh_token: process.env.GMAIL_REFRESH_TOKEN,
});

async function getTransporter() {
  const accessToken = await oAuth2Client.getAccessToken();
  return nodemailer.createTransport({
    service: "gmail",
    auth: {
      type: "OAuth2",
      user: process.env.GMAIL_SENDER,
      clientId: process.env.GMAIL_CLIENT_ID,
      clientSecret: process.env.GMAIL_CLIENT_SECRET,
      refreshToken: process.env.GMAIL_REFRESH_TOKEN,
      accessToken: accessToken.token,
    },
  });
}

async function sendEmail(to, subject, html, attachment, tipoDocumento) {
  const transporter = await getTransporter();
  await transporter.sendMail({
    from: process.env.GMAIL_SENDER,
    to,
    subject,
    html,
    attachments: [
      {
        filename: `${tipoDocumento}_${Date.now()}.pdf`,
        content: attachment,
      },
    ],
  });
}

async function sendEmailWithMultipleAttachments(
  to,
  subject,
  html,
  attachments,
  tipiDocumento
) {
  const transporter = await getTransporter();
  const mailAttachments = attachments.map((att, i) => ({
    filename: `${tipiDocumento[i]}_${Date.now()}_${i}.pdf`,
    content: att,
  }));

  await transporter.sendMail({
    from: process.env.GMAIL_SENDER,
    to,
    subject,
    html,
    attachments: mailAttachments,
  });
}

/* =========================
   TEMPLATE ID (Shared Drive)
========================= */
const TEMPLATES = {
  preventivo: {
    Privato: "159jDeDa5tsfsI_nKcTQcCrimeBKENAwwollvL1CqRVk",
    Azienda: "1-gv8ro45rvuI8nmpvkM5Rz00nlFnWsWSDxHSfcaZeCw",
  },
  contratto: {
    Privato: "1AReUg6aMIEAjd1TQOWO06aKpzUYXg0ZPNpy_oJZ-j74",
    Azienda: "1Pc8ZhS29tZXh16eCvXBHKgJC2_UStc799tc8-pE9Loc",
  },
};

/* =========================
   PLACEHOLDERS (GAS 1:1)
========================= */
const PLACEHOLDERS = [
  "cliente-tipo",
  "numero-preventivo",
  "ritiro-data-display",
  "ritiro-data",
  "ritiro-ora",
  "consegna-data-display",
  "consegna-data",
  "consegna-ora",
  "email",
  "cellulare",
  "veicolo-display",
  "veicolo",
  "chilometri",
  "preventivo",
  "zona-ritiro",
  "nome-cognome",
  "codice-fiscale",
  "indirizzo-residenza",
  "numero-patente",
  "denominazione",
  "partita-iva",
  "codice-fiscale-azienda",
  "indirizzo-sede",
  "guidatore1-nome",
  "guidatore1-patente",
  "guidatore2-nome",
  "guidatore2-patente",
  "responsabile-nome",
  "responsabile-cf",
  "responsabile-indirizzo",
  "responsabile-patente",
  "data-emissione",
  "km-extra",
];

/* =========================
   GOOGLE API (SA di Cloud Run)
========================= */
const auth = new google.auth.GoogleAuth({
  scopes: [
    "https://www.googleapis.com/auth/drive",
    "https://www.googleapis.com/auth/documents",
  ],
});

const drive = google.drive({ version: "v3", auth });
const docs = google.docs({ version: "v1", auth });

/* =========================
   CARTELLA CONDIVISA
========================= */
const TEMP_FOLDER_ID = "1_lvXfCK8b7zsrSZIpE1bSgPabZPuhzZ5";

/* =========================
   GENERAZIONE PDF
========================= */
async function generatePDF(templateId, data) {
  // 1️⃣ Copia template nello Shared Drive
  const copyRes = await drive.files.copy({
    fileId: templateId,
    supportsAllDrives: true,
    requestBody: {
      name: `temp_${Date.now()}`,
      parents: [TEMP_FOLDER_ID],
    },
  });

  const docId = copyRes.data.id;

  // 2️⃣ Replace placeholder
  const requests = PLACEHOLDERS.map((ph) => ({
    replaceAllText: {
      containsText: {
        text: `{{${ph}}}`,
        matchCase: true,
      },
      replaceText: data[ph] || "",
    },
  }));

  await docs.documents.batchUpdate({
    documentId: docId,
    requestBody: { requests },
  });

  // 3️⃣ Export PDF
  const pdfRes = await drive.files.export(
    {
      fileId: docId,
      mimeType: "application/pdf",
      supportsAllDrives: true,
    },
    { responseType: "arraybuffer" }
  );

  // 4️⃣ Elimina file temporaneo
  await drive.files.delete({
    fileId: docId,
    supportsAllDrives: true,
  });

  return Buffer.from(pdfRes.data);
}

/* =========================
   EMAIL HTML
========================= */
function prepareEmailBody(data) {
  const nome =
    data["nome-cognome"] || data["denominazione"] || "Cliente";
  return `
  <div style="font-family:Arial;max-width:600px;margin:auto">
    <h2>Gentile ${nome},</h2>
    <p>In allegato trovi il tuo preventivo.</p>
    <p><strong>Veicolo:</strong> ${data["veicolo-display"] || ""}</p>
    <p><strong>Importo:</strong> €${data["preventivo"] || ""}</p>
    <p>Cordiali saluti</p>
  </div>`;
}

function prepareInternalEmailBody(data, emailCliente) {
  const nome =
    data["nome-cognome"] || data["denominazione"] || "Cliente";
  return `
  <div style="font-family:Arial;max-width:600px;margin:auto">
    <h2>Nuovo preventivo generato</h2>
    <p><strong>Cliente:</strong> ${nome}</p>
    <p><strong>Email:</strong> ${emailCliente}</p>
    <p><strong>Importo:</strong> €${data["preventivo"] || ""}</p>
  </div>`;
}

/* =========================
   ENDPOINT
========================= */
app.post("/preventivo", async (req, res) => {
  try {
    const data = req.body;
    const tipo = data["cliente-tipo"] || "Privato";
    const internalEmail = process.env.INTERNAL_EMAIL;

    const pdfPreventivo = await generatePDF(
      TEMPLATES.preventivo[tipo],
      data
    );
    const pdfContratto = await generatePDF(
      TEMPLATES.contratto[tipo],
      data
    );

    await sendEmail(
      data.email,
      "Il tuo preventivo",
      prepareEmailBody(data),
      pdfPreventivo,
      "preventivo"
    );

    await sendEmailWithMultipleAttachments(
      internalEmail,
      `Preventivo e contratto - ${data["numero-preventivo"] || ""}`,
      prepareInternalEmailBody(data, data.email),
      [pdfPreventivo, pdfContratto],
      ["preventivo", "contratto"]
    );

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

app.listen(PORT, () =>
  console.log(`Server avviato sulla porta ${PORT}`)
);
