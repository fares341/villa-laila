export const env = {
  get databaseUrl() { return process.env.DATABASE_URL || ''; },
  get authSecret() { return process.env.AUTH_SECRET || ''; },
  get tz() { return process.env.HOSTEL_TZ || 'Africa/Cairo'; },
  get botToken() { return process.env.TELEGRAM_BOT_TOKEN || ''; },
  get staffChatId() { return process.env.TELEGRAM_STAFF_CHAT_ID || ''; },
  get geminiKey() { return process.env.GEMINI_API_KEY || ''; },
  get geminiModel() { return process.env.GEMINI_MODEL || 'gemini-2.5-flash'; },
  get openrouterKey() { return process.env.OPENROUTER_API_KEY || ''; },
  get openrouterModel() { return process.env.OPENROUTER_MODEL || 'google/gemini-2.5-flash'; },
  get baseUrl() { return process.env.PUBLIC_BASE_URL || ''; },
};
