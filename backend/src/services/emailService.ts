import nodemailer from 'nodemailer';
import { env, hasEmail } from '../config/env';
import { ApiError } from '../utils/apiResponse';
export async function deliverActionEmail(to: string, action: 'reset-password' | 'verify-email', token: string): Promise<void> {
  if (!hasEmail) {
    if (env.NODE_ENV === 'production') throw new ApiError(503, 'EMAIL_NOT_CONFIGURED', 'Email delivery is not configured');
    return;
  }
  const transport = nodemailer.createTransport({ host: env.SMTP_HOST, port: env.SMTP_PORT, secure: env.SMTP_SECURE === 'true', requireTLS: env.SMTP_SECURE !== 'true', auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } });
  const url = new URL(env.EMAIL_ACTION_URL);
  url.searchParams.set('action', action); url.searchParams.set('token', token);
  await transport.sendMail({ from: env.EMAIL_FROM, to, subject: action === 'reset-password' ? 'Reset MUSIKU+ password' : 'Verify MUSIKU+ email', text: `Open MUSIKU+ and enter this token for ${action}:\n${token}\nOr open: ${url.toString()}\nIgnore if you did not request this.` });
}
