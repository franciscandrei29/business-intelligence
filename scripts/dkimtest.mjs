import nodemailer from "nodemailer";
const t = nodemailer.createTransport({
  host: "127.0.0.1", port: 25, tls: { rejectUnauthorized: false }
});
const res = await t.sendMail({
  from: "Kimono BI <noreply@kimonogroup.ro>",
  to: "check-auth@verifier.port25.com",
  subject: "DKIM+SPF test Kimono BI",
  text: "Verificare autentificare email. Răspunsul vine înapoi pe adresa from.",
  html: "<p>Verificare autentificare DKIM + SPF pentru kimonogroup.ro.</p>",
});
console.log("queued:", res.messageId, res.response);
