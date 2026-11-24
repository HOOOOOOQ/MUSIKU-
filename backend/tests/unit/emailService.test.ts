import nodemailer from 'nodemailer';
import { env } from '../../src/config/env';
jest.mock('../../src/config/env',()=>({env:{NODE_ENV:'production',SMTP_HOST:'smtp.test.invalid',SMTP_PORT:587,SMTP_USER:'test',SMTP_PASSWORD:'unit-only',SMTP_SECURE:'false',EMAIL_FROM:'sender@example.com',EMAIL_ACTION_URL:'https://example.invalid/auth'},hasEmail:true}));
import {deliverActionEmail} from '../../src/services/emailService';
test('SMTP enforces STARTTLS and includes actionable reset token',async()=>{
 const sendMail=jest.fn().mockResolvedValue({});
 const transport=jest.spyOn(nodemailer,'createTransport').mockReturnValue({sendMail} as never);
 await deliverActionEmail('user@example.com','reset-password','unit-token');
 expect(transport).toHaveBeenCalledWith(expect.objectContaining({requireTLS:true,secure:false,host:'smtp.test.invalid'}));
 expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({to:'user@example.com',text:expect.stringContaining('unit-token')}));
 transport.mockRestore();
});
