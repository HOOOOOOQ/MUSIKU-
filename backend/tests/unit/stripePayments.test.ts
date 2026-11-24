import Stripe from 'stripe';
import { env } from '../../src/config/env';
import { processStripeWebhook, stripeClient } from '../../src/services/stripePayments';
beforeEach(()=> {env.PAYMENT_PROVIDER='stripe';env.PAYMENT_SECRET_KEY='unit-only-payment-key';env.PAYMENT_WEBHOOK_SECRET='unit-test-signing-secret';});
test('refuses absent gateway credentials',()=>{env.PAYMENT_SECRET_KEY='';expect(()=>stripeClient()).toThrow('not configured');});
test('rejects invalid webhook signature before persistence',async()=>{await expect(processStripeWebhook(Buffer.from('{}'),'forged')).rejects.toThrow('Invalid payment signature');});
test('valid signature for ignored event is acknowledged without DB access',async()=>{
 const body=JSON.stringify({id:'evt_unit',type:'customer.created',data:{object:{}}});
 const signature=Stripe.webhooks.generateTestHeaderString({payload:body,secret:env.PAYMENT_WEBHOOK_SECRET});
 await expect(processStripeWebhook(Buffer.from(body),signature)).resolves.toBeUndefined();
});
test('tampered body with valid header rejected',async()=>{
 const signature=Stripe.webhooks.generateTestHeaderString({payload:'{}',secret:env.PAYMENT_WEBHOOK_SECRET});
 await expect(processStripeWebhook(Buffer.from('{"paid":true}'),signature)).rejects.toThrow('Invalid payment signature');
});
