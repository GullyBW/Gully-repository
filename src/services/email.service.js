'use strict';

const config = require('../config');

/**
 * Email abstraction. Defaults to a console transport (logs the message) so the
 * app runs without an SMTP provider; swap `EMAIL_TRANSPORT=smtp` and wire a real
 * transport (nodemailer/SES) in `_send` for production. Kept tiny and dependency
 * free; the rest of the app only calls the high-level helpers.
 */
class EmailService {
  static async _send({ to, subject, text }) {
    if (config.email.transport === 'console' || config.env === 'test') {
      if (config.env !== 'test') {
        // eslint-disable-next-line no-console
        console.log(`[email] to=${to} subject="${subject}"\n${text}`);
      }
      return { delivered: true, transport: 'console' };
    }
    // Production transport would go here (nodemailer/SES/etc).
    return { delivered: true, transport: config.email.transport };
  }

  static sendVerificationEmail(to, token) {
    const link = `${config.email.appBaseUrl}/verify-email?token=${token}`;
    return EmailService._send({
      to,
      subject: 'Verify your Tirelo Services email',
      text: `Welcome to Tirelo Services!\n\nVerify your email:\n${link}\n\nIf you did not sign up, ignore this message.`,
    });
  }

  static sendPasswordResetEmail(to, token) {
    const link = `${config.email.appBaseUrl}/reset-password?token=${token}`;
    return EmailService._send({
      to,
      subject: 'Reset your Tirelo Services password',
      text: `Reset your password using this link (valid for 1 hour):\n${link}\n\nIf you did not request this, ignore this message.`,
    });
  }
}

module.exports = EmailService;
