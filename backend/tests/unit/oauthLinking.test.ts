jest.mock('../../src/services/googleIdentity', () => ({ googleIdentity: { verify: jest.fn() } }));
jest.mock('../../src/config/env', () => ({ env: {JWT_SECRET:'test-secret-over-sixteen',JWT_REFRESH_SECRET:'refresh-secret-over-sixteen',JWT_ACCESS_EXPIRES:'15m',JWT_REFRESH_EXPIRES:'30d'}, hasGoogleOAuth:true,hasEmail:false }));
jest.mock('../../src/models', () => {
  const { createFakeModel } = require('../helpers/fakeModel');
  return { User:createFakeModel(),UserProfile:createFakeModel(),UserSession:createFakeModel(),UserPreference:createFakeModel(),UserDevice:createFakeModel(),LoginHistory:createFakeModel(),PasswordReset:createFakeModel(),EmailVerification:createFakeModel(),NotificationPreference:createFakeModel(),OAuthReplay:createFakeModel() };
});
import { authService } from '../../src/services/authService';
import { googleIdentity } from '../../src/services/googleIdentity';
import * as models from '../../src/models';
const verify = googleIdentity.verify as jest.Mock;
beforeEach(() => { Object.values(models).forEach(m => (m as unknown as {_reset:()=>void})._reset?.()); verify.mockResolvedValue({ sub:'google-sub',email:'test@example.com',email_verified:true,exp:Date.now()/1000+1000 }); });
test('links only verified existing email and records login/device',async()=>{
 await models.User.create({email:'test@example.com',username:'test',emailVerified:true,status:'active',role:'user'});
 const result=await authService.loginWithGoogle('token',{deviceId:'android-device'});
 expect(result.tokens.refreshToken).toBeTruthy();expect((await models.User.findOne({email:'test@example.com'}))?.googleId).toBe('google-sub');
 expect(await models.LoginHistory.countDocuments()).toBe(1);expect(await models.UserDevice.countDocuments()).toBe(1);
});
test('rejects unverified email linking',async()=>{
 await models.User.create({email:'test@example.com',username:'test',emailVerified:false,status:'active'});
 await expect(authService.loginWithGoogle('token')).rejects.toThrow('Verify');
});
test('rejects suspended Google account',async()=>{
 await models.User.create({googleId:'google-sub',email:'test@example.com',status:'suspended'});
 await expect(authService.loginWithGoogle('token')).rejects.toThrow('Account unavailable');
});
test('unique replay record rejects repeated exchange',async()=>{
 jest.spyOn(models.OAuthReplay,'create').mockRejectedValueOnce(Object.assign(new Error('duplicate'),{code:11000}));
 await expect(authService.loginWithGoogle('replay')).rejects.toThrow('already exchanged');
});
