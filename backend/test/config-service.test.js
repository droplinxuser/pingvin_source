const test = require("node:test");
const assert = require("node:assert/strict");
const { ConfigService } = require("../dist/src/config/config.service.js");

const variable = (name, value, type = "string", category = "general") => ({
  name,
  category,
  type,
  value,
  defaultValue: "",
  obscured: false,
  secret: false,
  locked: false,
  order: 0,
});

test("reads typed values through the cached key index", () => {
  const variables = [
    variable("appName", "Example"),
    variable("showHomePage", "true", "boolean"),
    variable("chunkSize", "10485760", "number", "share"),
  ];
  const service = new ConfigService(variables, {});

  assert.equal(service.get("general.appName"), "Example");
  assert.equal(service.get("general.showHomePage"), true);
  assert.equal(service.get("share.chunkSize"), 10485760);

  // A config reload replaces the array; the next lookup must use the new rows.
  service.configVariables = [variable("appName", "Reloaded")];
  assert.equal(service.get("general.appName"), "Reloaded");
});
