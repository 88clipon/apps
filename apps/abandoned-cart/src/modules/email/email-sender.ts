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
    const key = `${config.host}:${config.port}:${config.user}`;
    const cached = this.cache.get(key);

    if (cached) return cached;

    const transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: !config.useTls && config.port === 465, // SSL on 465; STARTTLS otherwise
      auth: { user: config.user, pass: config.password },
      requireTLS: config.useTls,
    });

    this.cache.set(key, transporter);

    return transporter;
  }

  async send(args: {
    config: SmtpConfig;
    email: SendEmailArgs;
  }): Promise<Result<{ messageId: string }, Error>> {
    try {
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
      logger.warn("SMTP send failed", { error: cause, to: args.email.to });

      return err(cause instanceof Error ? cause : new Error(String(cause)));
    }
  }
}

export const emailSender = new EmailSender();
