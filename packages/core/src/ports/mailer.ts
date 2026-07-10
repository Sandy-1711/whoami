// Mailer port — how the domain sends an email. Core depends ONLY on this
// interface; the concrete transport (Gmail over SMTP via nodemailer) lives in
// apps/cli, and tests pass a fake. This is what keeps the email service free of
// any vendor SDK and unit-testable without a network.

export interface EmailAttachment {
  // Filename the recipient sees (e.g. "Sandeep Singh - AI Engineer.pdf").
  filename: string;
  // Absolute path to the file on disk.
  path: string;
  // Optional MIME type; nodemailer infers from the extension when omitted.
  contentType?: string;
}

export interface EmailMessage {
  // Sender address; defaults to the configured Gmail user when omitted.
  from?: string;
  to: string;
  subject: string;
  // Plain-text body (job-application emails are plain text on purpose).
  text: string;
  attachments?: EmailAttachment[];
}

export interface SendResult {
  messageId: string;
  accepted: string[];
  rejected: string[];
}

export interface Mailer {
  // True when credentials are configured and a send can be attempted. The CLI
  // checks this to fall back to draft-only when Gmail isn't set up.
  readonly available: boolean;
  send(msg: EmailMessage): Promise<SendResult>;
}

// A Mailer that refuses to send — the default when no credentials are present,
// and a safe stand-in for tests that never expect a send.
export const nullMailer: Mailer = {
  available: false,
  async send(): Promise<SendResult> {
    throw new Error('Gmail not configured — set GMAIL_USER and GMAIL_APP_PASSWORD in .env.');
  },
};
