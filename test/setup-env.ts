Object.assign(process.env, { NODE_ENV: "test" });
process.env.JWT_SECRET = "test-secret-test-secret-test-secret-1234";
process.env.AUTH_RATE_LIMIT = "1000";
process.env.FILE_STORAGE_DIR = require("node:path").join(require("node:os").tmpdir(), `axis-files-${process.pid}`);
process.env.CHANNEL_SECRET_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.META_APP_SECRET = "test-meta-app-secret";
process.env.META_VERIFY_TOKEN = "test-verify-token";
process.env.META_GRAPH_URL = "http://127.0.0.1:55990/v21.0";
