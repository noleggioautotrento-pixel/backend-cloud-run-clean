// index.js aggiornato per cartella condivisa
const express = require("express");
const bodyParser = require("body-parser");
const nodemailer = require("nodemailer");
const { google } = require("googleapis");

const app = express();
app.use(bodyParser.json());

const PORT = process.env.PORT || 8080;

// Gmail OAuth2
const oAuth2Client = new google.auth.OAuth2(
  process.env.GMAIL_CLIENT_ID,
  process.env.GMAIL_CLIENT_SECRET
);
oAuth2Client.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN });

// Funzioni invio email
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
      { filename: `${tipoDocumento}_${Date.now()}.pdf`, content: attachment }
    ],
  });
}

async function sendEmailWithMultipleAttachments(to, subject, html, attachments, tipiDocumento) {
  const transporter = await getTransporter();
  const mailAttachments = attachments.map((att, i) => ({
    filename: `${tipiDocumento[i]}_${Date.now()}_${i}.pdf`,
    content: att,
  }));
  await transporter.sendMail({ to, subject, html, attachments: mailAttachments });
}

// Template Docs (ID dei file copiati nella cartella condivisa)
const TEMPLATES = {
  preventivo: {
    Privato: '159jDeDa5tsfsI_nKcTQcCrimeBKENAwwollvL1CqRVk',
    Azienda: '1-gv8ro45rvuI8nmpvkM5Rz00nlFnWsWSDxHSfcaZeCw'
  },
  contratto: {
    Privato: '1AReUg6aMIEAjd1TQOWO06aKpzUYXg0ZPNpy_oJZ-j74',
    Azienda: '1Pc8ZhS29tZXh16eCvXBHKgJC2_UStc799tc8-pE9Loc'
  }
};

// Lista completa dei placeholder dal GAS
const PLACEHOLDERS = [
  'cliente-tipo', 'numero-preventivo', 'ritiro-data-display', 'ritiro-data', 'ritiro-ora',
  'consegna-data-display','consegna-data','consegna-ora','email','cellulare','veicolo-display',
  'veicolo','chilometri','preventivo','zona-ritiro','nome-cognome','codice-fiscale','indirizzo-residenza',
  'numero-patente','denominazione','partita-iva','codice-fiscale-azienda','indirizzo-sede',
  'guidatore1-nome','guidatore1-patente','guidatore2-nome','guidatore2-patente',
  'responsabile-nome','responsabile-cf','responsabile-indirizzo','responsabile-patente',
  'data-emissione','km-extra'
];

// Google APIs
const auth = new google.auth.GoogleAuth({
  scopes: [
    'https://www.googleapis.com/auth/documents',
    'https://www.googleapis.com/auth/drive'
  ]
});
const drive = google.drive({ version: 'v3', auth });
const docs = google.docs({ version: 'v1', auth });

// ID della cartella condivisa dove mettere le copie temporanee
const TEMP_FOLDER_ID = '1_lvXfCK8b7zsrSZIpE1bSgPabZPuhzZ5';

// Generazione PDF dai template
async function generatePDF(templateId, data) {
  // Copia del template nella cartella condivisa
  const copyRes = await drive.files.copy({
    fileId: templateId,
    requestBody: { 
      name: `temp_${Date.now()}`,
      parents: [TEMP_FOLDER_ID] // <- nuova cartella condivisa
    }
  });
  const docId = copyRes.data.id;

  // Sostituzione placeholder
  const requests = PLACEHOLDERS.map(ph => ({
    replaceAllText: {
      containsText: { text: `{{${ph}}}`, matchCase: true },
      replaceText: data[ph] || ''
    }
  }));
  await docs.documents.batchUpdate({ documentId: docId, requestBody: { requests } });

  // Esporta PDF
  const pdfRes = await drive.files.export(
    { fileId: docId, mimeType: 'application/pdf' },
    { responseType: 'arraybuffer' }
  );

  // Elimina copia temporanea
  await drive.files.delete({ fileId: docId });

  return Buffer.from(pdfRes.data);
}

// Stile HTML email (cliente)
function prepareEmailBody(data) {
  const nomeCliente = data['nome-cognome'] || data['denominazione'] || 'Cliente';
  return `
    <div style="font-family: Arial, sans-serif; max-width:600px;margin:0 auto;">
      <h2 style="color:#333;">Gentile ${nomeCliente},</h2>
      <p>Grazie per aver richiesto un preventivo. In allegato trovi il documento dettagliato.</p>
      <div style="background-color:#f9f9f9; padding:15px; border-radius:5px; margin:20px 0;">
        <h3 style="color:#555;">Riepilogo preventivo:</h3>
        <p><strong>Veicolo:</strong> ${data['veicolo-display']||''}</p>
        <p><strong>Importo:</strong> €${data['preventivo']||''}</p>
        <p><strong>Data ritiro:</strong> ${data['ritiro-data-display']||''}</p>
        <p><strong>Data consegna:</strong> ${data['consegna-data-display']||''}</p>
      </div>
      <p>Cordiali saluti,<br>Il Team</p>
    </div>
  `;
}

// Stile HTML email interna
function prepareInternalEmailBody(data, emailCliente) {
  const nomeCliente = data['nome-cognome'] || data['denominazione'] || 'Cliente';
  return `
    <div style="font-family: Arial, sans-serif; max-width:600px;margin:0 auto;">
      <h2 style="color:#333;">Preventivo e Contratto Generati</h2>
      <div style="background-color:#f9f9f9; padding:15px; border-radius:5px; margin:20px 0;">
        <h3 style="color:#555;">Dettagli cliente:</h3>
        <p><strong>Nome:</strong> ${nomeCliente}</p>
        <p><strong>Email:</strong> ${emailCliente}</p>
        <p><strong>Cellulare:</strong> ${data['cellulare'] || 'Non fornito'}</p>
        <p><strong>Veicolo:</strong> ${data['veicolo-display']||''}</p>
        <p><strong>Importo:</strong> €${data['preventivo']||''}</p>
        <p><strong>Data ritiro:</strong> ${data['ritiro-data-display']||''}</p>
        <p><strong>Data consegna:</strong> ${data['consegna-data-display']||''}</p>
        <p><strong>Numero preventivo:</strong> ${data['numero-preventivo']||''}</p>
        <p><strong>Tipo cliente:</strong> ${data['cliente-tipo']||''}</p>
      </div>
      <p><em>In allegato trovi sia il preventivo inviato al cliente che il contratto pronto.</em></p>
    </div>
  `;
}

// Endpoint principale
app.post("/preventivo", async (req, res) => {
  try {
    const data = req.body;
    const tipoCliente = data['cliente-tipo'] || 'Privato';
    const tuaEmail = process.env.INTERNAL_EMAIL;

    // Genera PDF
    const pdfPreventivo = await generatePDF(TEMPLATES.preventivo[tipoCliente], data);
    const pdfContratto = await generatePDF(TEMPLATES.contratto[tipoCliente], data);

    // Email al cliente
    await sendEmail(
      data.email,
      "Il tuo preventivo",
      prepareEmailBody(data),
      pdfPreventivo,
      "preventivo"
    );

    // Email interna
    await sendEmailWithMultipleAttachments(
      tuaEmail,
      `Preventivo e Contratto - ${data['nome-cognome'] || data['denominazione'] || 'Cliente'}`,
      prepareInternalEmailBody(data, data.email),
      [pdfPreventivo, pdfContratto],
      ["preventivo","contratto"]
    );

    res.json({
      success: true,
      emailInviataA: data.email,
      copiaInviataA: tuaEmail,
      clienteTipo: tipoCliente,
      documentiGenerati: ["preventivo","contratto"]
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.toString() });
  }
});

// Porta
app.listen(PORT, () => console.log(`Server avviato sulla porta ${PORT}`));
