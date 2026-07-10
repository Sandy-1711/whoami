// GmailMailer — the Mailer port over Gmail's SMTP via nodemailer. The only place
// the CLI opens an SMTP connection; the email service depends on the port, not
// this class, so it stays unit-testable without a network. Auth is a Google App
// Password (Account → Security → 2-Step Verification → App passwords), NOT the
// account password.
import nodemailer, { type Transporter } from 'nodemailer';
import type { Mailer, EmailMessage, SendResult } from '@resume/core';

export class GmailMailer implements Mailer {
  private transport?: Transporter;

  constructor(
    private readonly user: string,
    // App passwords are displayed in spaced groups of four; strip whitespace so
    // a pasted "abcd efgh ijkl mnop" authenticates.
    appPassword: string,
    private readonly pass = appPassword.replace(/\s+/g, ''),
  ) {}

  get available(): boolean {
    return Boolean(this.user && this.pass);
  }

  async send(msg: EmailMessage): Promise<SendResult> {
    if (!this.available) {
      throw new Error('Gmail not configured — set GMAIL_USER and GMAIL_APP_PASSWORD in .env.');
    }
    // Lazily build (and reuse) the transport so constructing the CLI container
    // never opens a socket.
    this.transport ??= nodemailer.createTransport({
      service: 'gmail', // smtp.gmail.com:465, implicit TLS
      auth: { user: this.user, pass: this.pass },
    });

    try {
      const info = await this.transport.sendMail({
        from: msg.from || this.user,
        to: msg.to,
        subject: msg.subject,
        text: msg.text,
        attachments: msg.attachments?.map((a) => ({
          filename: a.filename,
          path: a.path,
          contentType: a.contentType,
        })),
      });
      return {
        messageId: info.messageId,
        accepted: (info.accepted || []).map(addr),
        rejected: (info.rejected || []).map(addr),
      };
    } catch (err) {
      throw new Error(gmailHint((err as Error).message));
    }
  }
}

// nodemailer's accepted/rejected entries are string | Address.
function addr(a: unknown): string {
  return typeof a === 'string' ? a : String((a as { address?: string })?.address ?? a);
}

// Turn the common Gmail SMTP failures into something actionable.
function gmailHint(message: string): string {
  if (/Invalid login|Username and Password not accepted|BadCredentials|5\.7\.8/i.test(message)) {
    return 'Gmail rejected the login. Use a Google App Password (16 chars), not your account password, and make sure 2-Step Verification is on. Original: ' + message;
  }
  if (/ECONNREFUSED|ETIMEDOUT|ENOTFOUND|getaddrinfo/i.test(message)) {
    return 'Could not reach smtp.gmail.com — check your network/firewall. Original: ' + message;
  }
  return 'Failed to send via Gmail: ' + message;
}
