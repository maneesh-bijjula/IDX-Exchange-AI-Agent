import nodemailer from "nodemailer";

export type OutboundEmail = {
  to: string;
  subject: string;
  body: string;
};

export type EmailDeliveryReceipt = {
  messageId: string;
};

export type EmailSender = (
  email: OutboundEmail,
) => Promise<EmailDeliveryReceipt>;

type EmailTransportConfig = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  from: string;
};

export function readEmailTransportConfig(
  env: NodeJS.ProcessEnv = process.env,
): EmailTransportConfig {
  const user = env.EMAIL_USER?.trim() || env.SMTP_USER?.trim() || "";
  const password = env.EMAIL_PASSWORD || env.SMTP_PASSWORD || "";
  const host = env.SMTP_HOST?.trim() || "smtp.gmail.com";
  const port = Number(env.SMTP_PORT || 465);
  const secure = (env.SMTP_SECURE ?? "true").toLowerCase() !== "false";
  const from = env.EMAIL_FROM?.trim() || user;

  if (!user || !password || !from || !Number.isInteger(port) || port <= 0) {
    throw new Error(
      "Email delivery is not configured. Add EMAIL_USER, EMAIL_PASSWORD, and optional SMTP settings to .env.",
    );
  }

  return { host, port, secure, user, password, from };
}

export const sendEmailWithSmtp: EmailSender = async (email) => {
  const config = readEmailTransportConfig();
  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.password },
  });

  try {
    const result = await transporter.sendMail({
      from: config.from,
      to: email.to,
      subject: email.subject,
      text: email.body,
    });
    return { messageId: result.messageId };
  } catch {
    throw new Error(
      "Email delivery failed. Check the SMTP configuration and try the approval command again.",
    );
  }
};
