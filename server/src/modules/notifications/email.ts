import nodemailer, { type Transporter } from 'nodemailer';

import { env } from '../../config/env.js';
import { logger } from '../../core/logger.js';

/**
 * Email delivery with an explicit development mode: without SMTP_* config the
 * "send" is a clearly-labeled console line (never silently dropped, never
 * actually transmitted). SMTP is only wired when the env vars exist.
 */

export interface EmailMessage {
  to: string;
  subject: string;
  body: string;
}

let transporter: Transporter | null | undefined;

function getTransporter(): Transporter | null {
  if (transporter !== undefined) return transporter;
  if (!env.SMTP_HOST || !env.SMTP_PORT) {
    transporter = null;
    return transporter;
  }
  transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465,
    auth: env.SMTP_USER && env.SMTP_PASSWORD ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined,
  });
  return transporter;
}

export function emailEnabled(): boolean {
  return getTransporter() !== null;
}

export async function sendEmail(message: EmailMessage): Promise<void> {
  const tx = getTransporter();
  if (!tx) {
    // Dev-console mode — unmistakably labeled so it can never be mistaken
    // for real delivery in logs.
    logger.info(
      `[email:DEV-CONSOLE-MODE] (not sent — SMTP not configured) to=${message.to} subject="${message.subject}"\n${message.body}`,
    );
    return;
  }
  await tx.sendMail({
    from: env.EMAIL_FROM ?? 'ITSM <no-reply@itsm.local>',
    to: message.to,
    subject: message.subject,
    text: message.body,
  });
}
