/**
 * The route handlers must keep failure detail server side. A redacted but
 * detailed message still discloses internal topology and request state to
 * unauthenticated, CORS-open clients, so the client gets a generic string
 * while the log keeps the diagnostic.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const SOURCE = fs.readFileSync(path.join(__dirname, "index.js"), "utf8");

test("route handlers never send an error message to the client", () => {
  const disclosures = [];
  SOURCE.split("\n").forEach((line, index) => {
    const sends = /res\s*\.\s*(?:status\([^)]*\)\s*\.\s*)?(?:json|send)\s*\(/.test(line);
    if (!sends) return;
    if (/\b(?:e|err|error)\s*\??\.\s*(?:message|stack|response|config|userMessage)/.test(line)) {
      disclosures.push(`index.js:${index + 1}: ${line.trim()}`);
    }
  });

  assert.deepStrictEqual(
    disclosures.filter((line) => !line.includes("userMessage")),
    [],
    `these responses hand error detail to the client:\n${disclosures.join("\n")}`
  );
});

test("the generic responses are still present", () => {
  const generic = SOURCE.match(/res\.status\(500\)\.json\(\{ error: 'Internal server error' \}\)/g) || [];
  assert.ok(generic.length >= 5, `expected the 500 handlers to be generic, found ${generic.length}`);
  assert.ok(SOURCE.includes('res.status(404).send("Not found")'), "the catalog 404 must be generic");
});

test("every route catch still logs server side", () => {
  const logged = SOURCE.match(/logError\(/g) || [];
  assert.ok(logged.length >= 13, `expected the route catches to log, found ${logged.length} logError calls`);
});
