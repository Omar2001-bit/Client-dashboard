import { onRequest } from "firebase-functions/v2/https";
import * as nodemailer from "nodemailer";

const GMAIL_USER = process.env.GMAIL_USER ?? "";
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD ?? "";
const INTERNAL_SECRET = process.env.INTERNAL_EMAIL_SECRET ?? "";

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
});

export const sendEmailHttp = onRequest(async (req, res) => {
  if (req.method !== "POST") { res.status(405).send("Method Not Allowed"); return; }

  const secret = req.headers["x-internal-secret"];
  if (!INTERNAL_SECRET || secret !== INTERNAL_SECRET) {
    res.status(401).send("Unauthorized");
    return;
  }

  const { to, subject, html } = req.body ?? {};
  if (!to || !subject || !html) { res.status(400).json({ error: "to, subject, html required" }); return; }

  try {
    await transporter.sendMail({
      from: `Optimizers Support <${GMAIL_USER}>`,
      to,
      subject,
      html,
    });
    res.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[sendEmailHttp] error:", message);
    res.status(500).json({ error: message });
  }
});
