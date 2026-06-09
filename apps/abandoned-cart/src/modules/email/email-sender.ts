import { err, ok, Result } from "neverthrow";
import nodemailer, { Transporter } from "nodemailer";

import { createLogger } from "@/lib/logger";
import { SmtpConfig } from "@/modules/app-config/domain/app-config";

const logger = createLogger("EmailSender");

export type SendEmailArgs = {
  to: string;
  subject: string;
  html: string;
};

/**
 * Thin wrapper around nodemailer. Caches one transporter per (host, port, user)
 * tuple so we don't pay the SMTP connection cost per send. The cache is
 * intentionally process-local — restarts re-establish it.
 */
export class EmailSender {
  private cache = new Map<string, Transporter>();

  private getTransporter(config: SmtpConfig): Transporter {
    /*
     * Port 465 = implicit TLS from the start; 587/25 = plaintext then STARTTLS.
     * This is the standard nodemailer rule and matches how Saleor's own SMTP
     * (dj-email-url with tls=True on 587) connects to IONOS.
     */
    const secure = config.port === 465;
    /*
     * Include the password in the cache key so a transporter built with a stale
     * password (e.g. from an earlier failed test) is never silently reused.
     */
    const key = `${config.host}:${config.port}:${config.user}:${config.password}`;
    const cached = this.cache.get(key);

    if (cached) return cached;

    const transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure,
      requireTLS: !secure,
      /*
       * Force AUTH LOGIN. IONOS (and several shared hosts) reject AUTH PLAIN —
       * which nodemailer otherwise prefers — with "535 Authentication
       * credentials invalid" even when the credentials are correct. Python's
       * smtplib (used by Saleor's email plugins) negotiates LOGIN, which is why
       * the same credentials work there but not here.
       */
      authMethod: "LOGIN",
      auth: { user: config.user, pass: config.password },
    });

    this.cache.set(key, transporter);

    return transporter;
  }

  async send(args: {
    config: SmtpConfig;
    email: SendEmailArgs;
  }): Promise<Result<{ messageId: string }, Error>> {
    try {
      /*
       * Diagnostic — never logs the password itself, only its length so we can
       * tell a real secret from a leftover "********" mask (length 8).
       */
      logger.info("SMTP send attempt", {
        host: args.config.host,
        port: args.config.port,
        secure: args.config.port === 465,
        user: args.config.user,
        passwordLength: args.config.password.length,
        fromEmail: args.config.fromEmail,
        to: args.email.to,
      });

      const transporter = this.getTransporter(args.config);
      const result = await transporter.sendMail({
        from: `"${args.config.fromName}" <${args.config.fromEmail}>`,
        to: args.email.to,
        subject: args.email.subject,
        html: args.email.html,
      });

      logger.info("Email sent", {
        to: args.email.to,
        subject: args.email.subject,
        messageId: result.messageId,
      });

      return ok({ messageId: result.messageId });
    } catch (cause) {
      logger.warn("SMTP send failed", {
        message: cause instanceof Error ? cause.message : String(cause),
        to: args.email.to,
      });

      return err(cause instanceof Error ? cause : new Error(String(cause)));
    }
  }
}

export const emailSender = new EmailSender();
