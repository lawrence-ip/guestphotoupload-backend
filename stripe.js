const Database = require('./database');

class StripeService {
  constructor() {
    this.db = new Database();
    this.stripe = null;
    this.initialized = false;
  }

  initializeStripe() {
    if (!process.env.STRIPE_SECRET_KEY) {
      console.warn('STRIPE_SECRET_KEY not found in environment variables. Subscription features will be disabled.');
      return false;
    }

    try {
      const stripe = require('stripe');
      this.stripe = stripe(process.env.STRIPE_SECRET_KEY);
      this.initialized = true;
      return true;
    } catch (error) {
      console.error('Failed to initialize Stripe:', error.message);
      return false;
    }
  }

  async createCheckoutSession(userId, planId, successUrl, cancelUrl, regionalInfo = null) {
    if (!this.initialized && !this.initializeStripe()) {
      throw new Error('Stripe not configured');
    }

    try {
      const plan = await this.db.getSubscriptionPlan(planId);
      if (!plan) {
        throw new Error('Plan not found');
      }

      // Skip payment for free trial
      if (plan.is_trial) {
        await this.db.createUserSubscription(userId, planId);
        return { url: successUrl };
      }

      // Use regional pricing if provided
      let price = plan.price;
      let currency = 'usd';
      
      if (regionalInfo) {
        if (plan.name === 'Photo Plan') {
          price = regionalInfo.plans.photo_plan.price;
        } else if (plan.name === 'Media Plan') {
          price = regionalInfo.plans.media_plan.price;
        }
        currency = regionalInfo.currency.toLowerCase();
      }

      // Create or get Stripe price with regional currency
      const priceKey = `${plan.id}_${currency}`;
      let stripePriceId = plan[`stripe_price_id_${currency}`] || plan.stripe_price_id;
      
      if (!stripePriceId) {
        const stripePrice = await this.stripe.prices.create({
          unit_amount: Math.round(price * (currency === 'jpy' ? 1 : 100)), // JPY doesn't use cents
          currency: currency,
          product_data: {
            name: plan.name,
            description: plan.description,
          },
          recurring: null, // One-time payment
        });
        stripePriceId = stripePrice.id;

        // Update plan with regional stripe price ID
        await this.updatePlanStripeId(planId, stripePriceId, currency);
      }

      const user = await this.db.getUserById(userId);
      if (!user) {
        throw new Error('User not found');
      }

      const session = await this.stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        line_items: [
          {
            price: stripePriceId,
            quantity: 1,
          },
        ],
        mode: 'payment',
        success_url: `${successUrl}?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: cancelUrl,
        customer_email: user.email,
        metadata: {
          userId: userId.toString(),
          planId: planId.toString(),
          currency: currency,
          regionalPrice: price.toString()
        },
      });

      return { url: session.url };
    } catch (error) {
      throw new Error(`Failed to create checkout session: ${error.message}`);
    }
  }

  async updatePlanStripeId(planId, stripePriceId, currency = 'usd') {
    return new Promise((resolve, reject) => {
      // For now, just update the main stripe_price_id field
      // In a more complex system, you might store multiple price IDs for different currencies
      this.db.db.run(
        'UPDATE subscription_plans SET stripe_price_id = ? WHERE id = ?',
        [stripePriceId, planId],
        function(err) {
          if (err) reject(err);
          else resolve(this.changes);
        }
      );
    });
  }

  async handleWebhook(event) {
    if (!this.initialized && !this.initializeStripe()) {
      throw new Error('Stripe not configured');
    }

    try {
      switch (event.type) {
        case 'checkout.session.completed':
          await this.handleCheckoutCompleted(event.data.object);
          break;
        case 'payment_intent.succeeded':
          console.log('Payment succeeded:', event.data.object.id);
          break;
        default:
          console.log(`Unhandled event type: ${event.type}`);
      }
    } catch (error) {
      console.error('Webhook handler error:', error);
      throw error;
    }
  }

  async handleCheckoutCompleted(session) {
    try {
      const { userId, planId } = session.metadata;
      
      if (!userId || !planId) {
        throw new Error('Missing metadata in checkout session');
      }

      // Create subscription for the user
      await this.db.createUserSubscription(
        parseInt(userId),
        parseInt(planId),
        session.id
      );

      console.log(`Subscription created for user ${userId} with plan ${planId}`);
    } catch (error) {
      console.error('Error handling checkout completion:', error);
      throw error;
    }
  }

  async getSubscriptionStatus(userId) {
    try {
      const subscription = await this.db.getUserSubscription(userId);
      if (!subscription) {
        return { hasSubscription: false };
      }

      // Get usage information
      const usageCheck = await this.db.checkUsageLimits(userId, 0);
      
      return {
        hasSubscription: true,
        subscription: {
          id: subscription.id,
          planName: subscription.name,
          description: subscription.description,
          price: subscription.price,
          maxStorageGB: subscription.max_storage_gb,
          maxFiles: subscription.max_files,
          validityDays: subscription.validity_days,
          isTrial: subscription.is_trial,
          features: JSON.parse(subscription.features || '[]'),
          status: subscription.status,
          currentPeriodStart: subscription.current_period_start,
          currentPeriodEnd: subscription.current_period_end,
        },
        usage: usageCheck.allowed ? usageCheck.usage : null,
        isExpired: !usageCheck.allowed && usageCheck.reason === 'Subscription expired'
      };
    } catch (error) {
      throw new Error(`Failed to get subscription status: ${error.message}`);
    }
  }

  async createCustomerPortalSession(userId, returnUrl) {
    try {
      const user = await this.db.getUserById(userId);
      if (!user) {
        throw new Error('User not found');
      }

      // For now, redirect to a simple billing page since we're using one-time payments
      // In a full implementation, you'd create actual customers and subscriptions
      return { url: returnUrl };
    } catch (error) {
      throw new Error(`Failed to create portal session: ${error.message}`);
    }
  }
}

module.exports = StripeService;