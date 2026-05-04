import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { getAdminAuth } from "./lib/firebaseAdmin";

const ACTION_CODE_SETTINGS = {
  url: `https://client-dash-9b027.web.app/set-password`,
  handleCodeInApp: true,
};

export const sendOnboardingEmail = onDocumentCreated(
  "users/{uid}",
  async (event) => {
    const data = event.data?.data();
    if (!data || data.role !== "client" || data.skipOnboardingEmail === true) return;

    const auth = getAdminAuth();

    try {
      const link = await auth.generateSignInWithEmailLink(data.email, ACTION_CODE_SETTINGS);

      // In production, send via SendGrid or Firebase Email Extension.
      // For now, log the link — replace this block with your email provider call.
      console.info(`[ONBOARDING] Magic link for ${data.email}: ${link}`);

      // --- SendGrid example (uncomment and set SENDGRID_API_KEY secret) ---
      // const sgMail = require("@sendgrid/mail");
      // sgMail.setApiKey(process.env.SENDGRID_API_KEY);
      // await sgMail.send({
      //   to: data.email,
      //   from: "noreply@youragency.com",
      //   subject: "You're invited to your CRO Results Dashboard",
      //   html: buildOnboardingHtml(data.name, link),
      // });
    } catch (err) {
      console.error("Failed to send onboarding email:", err);
    }
  }
);
