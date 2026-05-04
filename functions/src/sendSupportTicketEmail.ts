import { onDocumentCreated } from "firebase-functions/v2/firestore";
import axios from "axios";

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const SUPPORT_EMAIL = "omar@optimizers.agency";

export const sendSupportTicketEmail = onDocumentCreated(
  "supportTickets/{ticketId}",
  async (event) => {
    const data = event.data?.data();
    if (!data) return;

    const submittedAt = data.createdAt?.toDate
      ? data.createdAt.toDate().toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })
      : new Date().toLocaleString();

    const messageHtml = String(data.message ?? "").replace(/\n/g, "<br>");

    try {
      await axios.post(
        "https://api.resend.com/emails",
        {
          from: "Optimizers Support <noreply@optimizers.agency>",
          to: [SUPPORT_EMAIL],
          subject: `[Support] New ticket from ${data.clientName}`,
          html: `
            <div style="font-family:sans-serif;max-width:600px;color:#0e1c26">
              <h2 style="margin:0 0 16px">New Support Ticket</h2>
              <table style="border-collapse:collapse;width:100%;margin-bottom:20px">
                <tr>
                  <td style="padding:8px 0;color:#666;width:140px">Client</td>
                  <td style="padding:8px 0;font-weight:600">${data.clientName}</td>
                </tr>
                <tr>
                  <td style="padding:8px 0;color:#666">Submitted by</td>
                  <td style="padding:8px 0">${data.createdByName} &lt;${data.createdByEmail}&gt;</td>
                </tr>
                <tr>
                  <td style="padding:8px 0;color:#666">Date</td>
                  <td style="padding:8px 0">${submittedAt}</td>
                </tr>
              </table>
              <div style="background:#f7fafb;border-left:4px solid #6ae499;border-radius:4px;padding:16px;margin-bottom:24px">
                <p style="margin:0;line-height:1.6">${messageHtml}</p>
              </div>
              <p style="font-size:12px;color:#999">
                Ticket ID: ${event.params.ticketId}
              </p>
            </div>
          `,
        },
        {
          headers: {
            Authorization: `Bearer ${RESEND_API_KEY}`,
            "Content-Type": "application/json",
          },
        }
      );
      console.info(`[supportTicket] Email sent for ticket ${event.params.ticketId}`);
    } catch (err) {
      console.error("[supportTicket] Failed to send email:", err);
    }
  }
);
