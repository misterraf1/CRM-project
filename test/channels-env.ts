// Imported first by the channels spec: provider APIs point at a local fake (config() reads env once)
process.env.TELEGRAM_API_URL = "http://127.0.0.1:55992/tg";
process.env.META_GRAPH_URL = "http://127.0.0.1:55992/v21.0";
