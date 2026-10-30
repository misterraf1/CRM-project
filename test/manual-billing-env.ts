// Imported first by specs that need the platform-managed (manual) billing provider:
// config() reads the environment once, when the app is created.
process.env.BILLING_PROVIDER = "manual";
