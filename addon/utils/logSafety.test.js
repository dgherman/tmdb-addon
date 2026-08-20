/**
 * Repository level guard.
 *
 * The credential leak this suite protects against is trivial to reintroduce:
 * one `console.error(error)` on an Axios rejection is enough to print the TMDB
 * key, a Trakt bearer token or an MDBList key into the logs. Unit tests of the
 * sanitizer cannot catch that, because the offending code simply bypasses it.
 *
 * So this test scans the server side source tree and fails if any raw error
 * value is handed to console.*. Use the shared `logError` helper instead. If a
 * particular line is genuinely safe, annotate it with the opt-out comment
 * `// safe-log-reviewed` (on the same line or the line above) and say why.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..");
const SCAN_DIRS = ["addon"];
const SCAN_ROOT_FILES = ["test-proxy.js"];
const SKIP_DIRS = new Set(["node_modules", "dist", ".git", "configure", "public", "docs"]);

const OPT_OUT = "safe-log-reviewed";
const ERROR_IDENTIFIERS = "err|error|e|ex|exception|reason|fallbackError|apiError";

const FORBIDDEN = [
  {
    name: "bare .catch(console.error)",
    pattern: new RegExp(String.raw`\.catch\(\s*console\.(?:error|log|warn)\s*\)`),
  },
  {
    name: "raw error object as the first console argument",
    pattern: new RegExp(String.raw`console\.(?:error|log|warn)\(\s*(?:${ERROR_IDENTIFIERS})\s*[,)]`),
  },
  {
    name: "raw error object as a later console argument",
    pattern: new RegExp(
      String.raw`console\.(?:error|log|warn)\(.*,\s*(?:${ERROR_IDENTIFIERS})\s*[,)]`
    ),
  },
  {
    name: "JSON.stringify of an error object",
    pattern: new RegExp(String.raw`JSON\.stringify\(\s*(?:${ERROR_IDENTIFIERS})\s*[,)]`),
  },
  {
    name: "logging an Axios request config or request object",
    pattern: new RegExp(
      String.raw`console\.(?:error|log|warn)\(.*(?:${ERROR_IDENTIFIERS})\.(?:config|request|response)\b`
    ),
  },
];

function collectFiles(dir, acc) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      collectFiles(path.join(dir, entry.name), acc);
    } else if (entry.isFile() && entry.name.endsWith(".js") && !entry.name.endsWith(".test.js")) {
      acc.push(path.join(dir, entry.name));
    }
  }
  return acc;
}

function sourceFiles() {
  const files = [];
  for (const dir of SCAN_DIRS) collectFiles(path.join(ROOT, dir), files);
  for (const file of SCAN_ROOT_FILES) {
    const full = path.join(ROOT, file);
    if (fs.existsSync(full)) files.push(full);
  }
  return files;
}

function scan(files) {
  const violations = [];

  for (const file of files) {
    const lines = fs.readFileSync(file, "utf8").split("\n");

    lines.forEach((line, index) => {
      const previous = index > 0 ? lines[index - 1] : "";
      if (line.includes(OPT_OUT) || previous.includes(OPT_OUT)) return;

      for (const rule of FORBIDDEN) {
        if (rule.pattern.test(line)) {
          violations.push(`${path.relative(ROOT, file)}:${index + 1}: ${rule.name}\n    ${line.trim()}`);
          break;
        }
      }
    });
  }

  return violations;
}

test("no raw error values are handed to console.* anywhere in the addon", () => {
  const files = sourceFiles();
  assert.ok(files.length > 20, `expected to scan the addon source tree, only found ${files.length} files`);

  const violations = scan(files);
  assert.deepStrictEqual(
    violations,
    [],
    `Raw error logging can serialize credentials (Axios attaches the request config, ` +
      `including api_key, Authorization headers and client_secret, to its errors).\n` +
      `Use logError() from addon/utils/logError.js, or annotate the line with ` +
      `"${OPT_OUT}" if it is genuinely safe.\n\n${violations.join("\n")}`
  );
});

test("the guard itself detects a reintroduced raw sink", () => {
  const fixture = path.join(
    fs.mkdtempSync(path.join(require("node:os").tmpdir(), "logsafety-")),
    "offender.js"
  );
  fs.writeFileSync(
    fixture,
    [
      "async function f() {",
      "  try { await g(); } catch (error) { console.error('boom:', error); }",
      "}",
      "h().catch(console.error);",
    ].join("\n")
  );

  const violations = scan([fixture]);
  assert.strictEqual(violations.length, 2, `expected two violations, got:\n${violations.join("\n")}`);

  fs.rmSync(path.dirname(fixture), { recursive: true, force: true });
});

test("the opt-out comment suppresses a finding", () => {
  const dir = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "logsafety-"));
  const fixture = path.join(dir, "vetted.js");
  fs.writeFileSync(fixture, `console.error('vetted:', error); // ${OPT_OUT}: not an Axios error\n`);

  assert.deepStrictEqual(scan([fixture]), []);

  fs.rmSync(dir, { recursive: true, force: true });
});
