# Subscription System Setup

## Overview
This application now includes a subscription-based system with three tiers:

1. **Free Trial** - 10 photos, 7 days validity, free
2. **Photo Plan** - 5GB storage, 30 days validity, $9.99
3. **Media Plan** - 15GB storage, 180 days validity, $29.99

## Stripe Configuration

### 1. Create a Stripe Account
1. Go to [stripe.com](https://stripe.com) and create an account
2. Navigate to the Dashboard

### 2. Get API Keys
1. Go to Developers > API Keys
2. Copy your **Publishable key** and **Secret key**
3. For testing, use the test keys (they start with `pk_test_` and `sk_test_`)

### 3. Set Up Environment Variables
Add these to your `.env` file:
```env
STRIPE_SECRET_KEY=sk_test_your_secret_key_here
STRIPE_PUBLISHABLE_KEY=pk_test_your_publishable_key_here
STRIPE_WEBHOOK_SECRET=whsec_your_webhook_secret_here
```

### 4. Configure Webhooks
1. Go to Developers > Webhooks in your Stripe dashboard
2. Click "Add endpoint"
3. Enter your endpoint URL: `https://yourdomain.com/api/stripe/webhook`
4. Select events to listen for:
   - `checkout.session.completed`
   - `payment_intent.succeeded`
5. Copy the webhook signing secret and add it to your `.env` file

## Database Schema
The subscription system adds these tables:
- `subscription_plans` - Available plans
- `user_subscriptions` - User's active subscriptions
- `usage_tracking` - Track file count and storage usage

## Features

### Plan Limits
- **File Count**: Some plans limit the number of files
- **Storage**: All plans have storage limits in GB
- **Validity**: Each plan has different validity periods
- **Automatic Expiration**: Tokens expire with subscription period

### Usage Tracking
- Real-time usage monitoring
- Storage tracking in GB
- File count tracking
- Progress bars in dashboard

### Payment Flow
1. User selects a plan
2. Redirects to Stripe Checkout
3. Payment processed by Stripe
4. Webhook confirms payment
5. Subscription activated automatically

## Testing

### Test with Stripe
Use these test card numbers:
- **Success**: 4242 4242 4242 4242
- **Decline**: 4000 0000 0000 0002

### Free Trial
Users can start with a free trial (no payment required):
- 10 photo uploads
- 7 days validity
- Automatic activation

## Development Setup

1. Install dependencies:
   ```bash
   npm install stripe
   ```

2. Update environment variables in `.env`

3. Start the server:
   ```bash
   npm start
   ```

4. Database tables will be created automatically on first run

## Production Deployment

### Environment Variables
Ensure these are set in production:
- `STRIPE_SECRET_KEY` - Your live Stripe secret key
- `STRIPE_PUBLISHABLE_KEY` - Your live Stripe publishable key  
- `STRIPE_WEBHOOK_SECRET` - Your webhook signing secret
- `APP_URL` - Your production domain

### Webhook Endpoint
Configure your production webhook endpoint:
`https://yourdomain.com/api/stripe/webhook`

### Security Notes
- Never expose secret keys in client-side code
- Always verify webhooks using the signing secret
- Use HTTPS in production for webhook endpoints
- Store sensitive data securely

## API Endpoints

### Subscription Management
- `GET /api/subscription/plans` - Get available plans
- `POST /api/subscription/checkout` - Create checkout session
- `GET /api/subscription/status` - Get user subscription status
- `POST /api/stripe/webhook` - Handle Stripe webhooks

### Usage Tracking
- `GET /api/user-stats` - Get usage statistics
- Usage limits enforced on file uploads

## Customization

### Adding New Plans
1. Update the `initializeDefaultPlans()` method in `database.js`
2. Restart the application to create new plans
3. Plans will appear automatically in the dashboard

### Changing Pricing
1. Update plan prices in the database
2. Stripe prices are created automatically
3. Old prices remain valid for existing customers

## Support
- Check Stripe dashboard for payment issues
- Monitor webhook delivery for failed events
- Review application logs for errors