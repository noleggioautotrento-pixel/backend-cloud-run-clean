// index.js — versione con gestione auto/pulmino SOLO per contratti

const express = require("express");
const bodyParser = require("body-parser");
const nodemailer = require("nodemailer");
const { google } = require("googleapis");

const app = express();
app.use(bodyParser.json());

const PORT = process.env.PORT || 8080;

/* =========================
   OAuth2 CLIENT UNICO
   (Gmail + Drive + Docs)
========================= */
const oAuth2Client = new google.auth.OAuth2(
  process.env.GMAIL_CLIENT_ID,
  process.env.GMAIL_CLIENT_SECRET
);

oAuth2Client.setCredentials({
  refresh_token: process.env.GMAIL_REFRESH_TOKEN
});

/* =========================
   Google APIs (OAuth2)
========================= */
const drive = google.drive({
  version: "v3",
  auth: oAuth2Client
});

const docs = google.docs({
  version: "v1",
  auth: oAuth2Client
});

/* =========================
   Gmail (Nodemailer)
========================= */
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
      accessToken: accessToken.token
    }
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
        content: attachment
      }
    ]
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

  const mailAttachments = attachments.map((buf, i) => ({
    filename: `${tipiDocumento[i]}_${Date.now()}_${i}.pdf`,
    content: buf
  }));

  await transporter.sendMail({
    from: process.env.GMAIL_SENDER,
    to,
    subject,
    html,
    attachments: mailAttachments
  });
}

/* =========================
   TEMPLATE GOOGLE DOCS
========================= */
const TEMPLATES = {
  preventivo: {
    Privato: "159jDeDa5tsfsI_nKcTQcCrimeBKENAwwollvL1CqRVk",
    Azienda: "1-gv8ro45rvuI8nmpvkM5Rz00nlFnWsWSDxHSfcaZeCw"
  },
  contratto: {
    Privato: {
      auto: "1X95XzczTC0nJVu3vhV5Ah-ZlNq4M2Ed0t35FNYrLKus",      // NUOVO: Auto
      pulmino: "1AReUg6aMIEAjd1TQOWO06aKpzUYXg0ZPNpy_oJZ-j74"   // ESISTENTE: Pulmino
    },
    Azienda: {
      auto: "1bab0d7QYP9TO3XZt2Hcqt9aRG5e6fdLCWp8TIhxWyws",      // NUOVO: Auto
      pulmino: "1Pc8ZhS29tZXh16eCvXBHKgJC2_UStc799tc8-pE9Loc"   // ESISTENTE: Pulmino
    }
  }
};

/* =========================
   PLACEHOLDER (1:1 GAS)
========================= */
const PLACEHOLDERS = [
  "cliente-tipo","numero-preventivo","ritiro-data-display","ritiro-data","ritiro-ora",
  "consegna-data-display","consegna-data","consegna-ora","email","cellulare",
  "veicolo-display","veicolo","chilometri","preventivo","zona-ritiro",
  "nome-cognome","codice-fiscale","indirizzo-residenza","numero-patente",
  "denominazione","partita-iva","codice-fiscale-azienda","indirizzo-sede",
  "guidatore1-nome","guidatore1-patente","guidatore2-nome","guidatore2-patente",
  "responsabile-nome","responsabile-cf","responsabile-indirizzo",
  "responsabile-patente","data-emissione","km-extra"
];

/* =========================
   GENERAZIONE PDF
========================= */
async function generatePDF(templateId, data) {
  // Copia template
  const copyRes = await drive.files.copy({
    fileId: templateId,
    requestBody: {
      name: `temp_${Date.now()}`
    }
  });

  const docId = copyRes.data.id;

  // Replace placeholder
  const requests = PLACEHOLDERS.map(ph => ({
    replaceAllText: {
      containsText: {
        text: `{{${ph}}}`,
        matchCase: true
      },
      replaceText: data[ph] || ""
    }
  }));

  await docs.documents.batchUpdate({
    documentId: docId,
    requestBody: { requests }
  });

  // Export PDF
  const pdfRes = await drive.files.export(
    {
      fileId: docId,
      mimeType: "application/pdf"
    },
    { responseType: "arraybuffer" }
  );

  // Cleanup
  await drive.files.delete({ fileId: docId });

  return Buffer.from(pdfRes.data);
}

/* =========================
   EMAIL HTML (CLIENTE) - ORIGINALE
========================= */
function prepareEmailBody(data) {
  const nomeCliente =
    data["nome-cognome"] || data["denominazione"] || "Cliente";

  return `
  <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
    <h2 style="color:#333;">Gentile ${nomeCliente},</h2>
    <p>Grazie per aver richiesto un preventivo. In allegato trovi il documento dettagliato.</p>
    <div style="background:#f9f9f9;padding:15px;border-radius:5px;margin:20px 0;">
      <h3 style="color:#555;">Riepilogo preventivo:</h3>
      <p><strong>Veicolo:</strong> ${data["veicolo-display"] || ""}</p>
      <p><strong>Importo:</strong> €${data["preventivo"] || ""}</p>
      <p><strong>Data ritiro:</strong> ${data["ritiro-data-display"] || ""}</p>
      <p><strong>Data consegna:</strong> ${data["consegna-data-display"] || ""}</p>
    </div>
    <p>Cordiali saluti,<br>Il Team</p>
  </div>
  `;
}

/* =========================
   EMAIL HTML (INTERNA) - ORIGINALE
========================= */
function prepareInternalEmailBody(data, emailCliente) {
  const nomeCliente =
    data["nome-cognome"] || data["denominazione"] || "Cliente";

  return `
  <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
    <h2 style="color:#333;">Preventivo e Contratto Generati</h2>
    <div style="background:#f9f9f9;padding:15px;border-radius:5px;margin:20px 0;">
      <h3 style="color:#555;">Dettagli cliente:</h3>
      <p><strong>Nome:</strong> ${nomeCliente}</p>
      <p><strong>Email:</strong> ${emailCliente}</p>
      <p><strong>Cellulare:</strong> ${data["cellulare"] || "Non fornito"}</p>
      <p><strong>Veicolo:</strong> ${data["veicolo-display"] || ""}</p>
      <p><strong>Importo:</strong> €${data["preventivo"] || ""}</p>
      <p><strong>Data ritiro:</strong> ${data["ritiro-data-display"] || ""}</p>
      <p><strong>Data consegna:</strong> ${data["consegna-data-display"] || ""}</p>
      <p><strong>Numero preventivo:</strong> ${data["numero-preventivo"] || ""}</p>
      <p><strong>Tipo cliente:</strong> ${data["cliente-tipo"] || ""}</p>
    </div>
    <p><em>In allegato trovi sia il preventivo inviato al cliente che il contratto pronto.</em></p>
  </div>
  `;
}

/* =========================
   ENDPOINT - MODIFICA MINIMA
========================= */
app.post("/preventivo", async (req, res) => {
  try {
    const data = req.body;
    const tipoCliente = data["cliente-tipo"] || "Privato";
    const tuaEmail = process.env.INTERNAL_EMAIL;

    // DETERMINA SE È AUTO O PULMINO
    const veicoloValue = data["veicolo"] || "";
    const isAuto = veicoloValue.toLowerCase() === "auto";

    // GENERA PREVENTIVO (sempre lo stesso)
    const pdfPreventivo = await generatePDF(
      TEMPLATES.preventivo[tipoCliente],
      data
    );

    // SELEZIONA IL CONTRATTO CORRETTO
    let templateContrattoId;
    if (isAuto) {
      templateContrattoId = TEMPLATES.contratto[tipoCliente].auto;
    } else {
      templateContrattoId = TEMPLATES.contratto[tipoCliente].pulmino;
    }

    // GENERA CONTRATTO
    const pdfContratto = await generatePDF(templateContrattoId, data);

    // INVIA EMAIL - TUTTO IDENTICO ALL'ORIGINALE
    await sendEmail(
      data.email,
      "Il tuo preventivo",  // OGGETTO ORIGINALE
      prepareEmailBody(data),  // CORPO ORIGINALE
      pdfPreventivo,
      "preventivo"
    );

    await sendEmailWithMultipleAttachments(
      tuaEmail,
      `Preventivo e Contratto - ${data["nome-cognome"] || data["denominazione"] || "Cliente"}`,  // OGGETTO ORIGINALE
      prepareInternalEmailBody(data, data.email),  // CORPO ORIGINALE
      [pdfPreventivo, pdfContratto],
      ["preventivo", "contratto"]
    );

    res.json({
      success: true,
      emailInviataA: data.email,
      copiaInviataA: tuaEmail,
      clienteTipo: tipoCliente,
      documentiGenerati: ["preventivo", "contratto"]
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

/* ========================= */
app.listen(PORT, () =>
  console.log(`Server avviato sulla porta ${PORT}`)
);