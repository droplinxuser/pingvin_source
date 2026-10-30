const test = require("node:test");
const assert = require("node:assert/strict");
const {
  ContactService,
} = require("../dist/src/contact/contact.service.js");

const message = {
  name: "Test User",
  email: "test@example.com",
  subject: "Hello",
  message: "A contact message",
  turnstileToken: "token",
};

function createConfig(values = { smtp: { enabled: true, email: "admin@example.com" } }) {
  return {
    get: (key) => {
      const [group, field] = key.split(".");
      return values[group]?.[field];
    },
  };
}

test("rejects contact submissions when Turnstile is not configured", async () => {
  delete process.env.CFT_KEY;
  delete process.env.CFT_SECRET;
  const service = new ContactService(createConfig(), {
    sendContactEmail: async () => {},
  });

  await assert.rejects(
    () => service.send(message),
    (error) => error.status === 503,
  );
  assert.equal(service.publicConfig().enabled, false);
});

test("verifies Turnstile and queues the email in the background", async () => {
  process.env.CFT_KEY = "test-site-key";
  process.env.CFT_SECRET = "test-secret";
  let sent;
  let verificationBody;
  const service = new ContactService(createConfig(), {
    sendContactEmail: async (...args) => {
      sent = args;
    },
  });

  const originalFetch = global.fetch;
  global.fetch = async (_url, options) => {
    verificationBody = options.body;
    return {
      ok: true,
      json: async () => ({ success: true, action: "contact" }),
    };
  };

  try {
    await service.send(message, "203.0.113.10");
    await new Promise((resolve) => setImmediate(resolve));
  } finally {
    global.fetch = originalFetch;
  }

  assert.equal(verificationBody.get("secret"), "test-secret");
  assert.equal(verificationBody.get("response"), "token");
  assert.equal(verificationBody.get("remoteip"), "203.0.113.10");
  assert.deepEqual(sent, [
    "Test User",
    "test@example.com",
    "Hello",
    "A contact message",
  ]);
  assert.equal(service.publicConfig().enabled, true);
});

test("does not send email when Turnstile rejects the token", async () => {
  process.env.CFT_KEY = "test-site-key";
  process.env.CFT_SECRET = "test-secret";
  let sent = false;
  const service = new ContactService(createConfig(), {
    sendContactEmail: async () => {
      sent = true;
    },
  });

  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    json: async () => ({ success: false, "error-codes": ["invalid-input"] }),
  });

  try {
    await assert.rejects(
      () => service.send(message),
      (error) => error.status === 400,
    );
    await new Promise((resolve) => setImmediate(resolve));
  } finally {
    global.fetch = originalFetch;
  }
  assert.equal(sent, false);
});

test("sanitizes line breaks out of the email subject and reply name", async () => {
  process.env.CFT_KEY = "test-site-key";
  process.env.CFT_SECRET = "test-secret";
  let sent;
  const service = new ContactService(createConfig(), {
    sendContactEmail: async (...args) => {
      sent = args;
    },
  });

  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    json: async () => ({ success: true, action: "contact" }),
  });

  try {
    await service.send({
      ...message,
      name: "User\r\nBcc: victim@example.com",
      subject: "Hello\r\nBcc: victim@example.com",
    });
    await new Promise((resolve) => setImmediate(resolve));
  } finally {
    global.fetch = originalFetch;
  }

  assert.equal(sent[0], "User Bcc: victim@example.com");
  assert.equal(sent[2], "Hello Bcc: victim@example.com");
});
