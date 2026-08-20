/**
 * Repository level guard.
 *
 * The credential leak this suite protects against is trivial to reintroduce:
 * one `console.error(error)` on an Axios rejection is enough to print the TMDB
 * key, a Trakt bearer token or an MDBList key into the logs. Unit tests of the
 * sanitizer cannot catch that, because the offending code simply bypasses it.
 *
 * So this test scans the server side source tree and fails when an error value
 * reaches a logging sink without going through `logError()` / `redactUrl()`
 * from addon/utils/logError.js. It deliberately flags `error.message` and
 * `error.stack` too: provider, transport and proxy errors can embed URLs,
 * request derived strings and `Authorization` material in both.
 *
 * What counts as a sink: `console.*` (including `console.dir`), any local alias
 * of a console method (`const log = console.error`, `const { error: log } =
 * console`), `logger.*` style wrappers, `util.inspect` and `JSON.stringify`.
 * Calls spanning several lines are analyzed whole.
 *
 * Scope: the server side tree (`addon/`) plus root level scripts. `configure/`
 * is deliberately excluded - it is the browser bundle, where `fetch` errors
 * carry no Axios request config and the console belongs to the end user, not
 * to the server operator.
 *
 * Opt out: annotate the line (or the line above it) with
 * `safe-log-reviewed: <reason>`. The reason is mandatory; a bare marker fails,
 * so silencing a finding always leaves a written justification behind.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..");
const SCAN_DIRS = ["addon"];
const SKIP_DIRS = new Set(["node_modules", "dist", ".git", "configure", "public", "docs", "coverage"]);
const SCANNED_EXTENSIONS = [".js", ".cjs", ".mjs", ".ts"];

const OPT_OUT = "safe-log-reviewed";
const OPT_OUT_WITH_REASON = new RegExp(`${OPT_OUT}\\s*:\\s*\\S+`);

// Identifiers conventionally holding a caught error or a rejection reason.
const ERROR_IDENTIFIER = String.raw`(?:err|error|e|ex|exception|reason|primaryError|fallbackError|apiError|cacheError|lastError)`;
// The identifier alone, or with any property path hanging off it
// (`error.message`, `error?.response?.data`, `e.stack`).
const ERROR_REFERENCE = new RegExp(String.raw`\b${ERROR_IDENTIFIER}\b(?:\s*\??\.\s*\w+)*`);

const SINK_METHODS = ["log", "error", "warn", "info", "debug", "trace", "dir"];

/** Strip line comments, string literals and the static parts of template
 * literals, while keeping `${...}` expressions - interpolating an error is
 * exactly the case this guard has to catch. */
function newlinesIn(text) {
  return "\n".repeat((text.match(/\n/g) || []).length);
}

function stripLiterals(code) {
  let out = "";
  let i = 0;

  while (i < code.length) {
    const ch = code[i];

    if (ch === "/" && code[i + 1] === "/") {
      while (i < code.length && code[i] !== "\n") i += 1;
      continue;
    }
    if (ch === "/" && code[i + 1] === "*") {
      const start = i;
      i += 2;
      while (i < code.length && !(code[i] === "*" && code[i + 1] === "/")) i += 1;
      i += 2;
      out += newlinesIn(code.slice(start, i));
      continue;
    }
    if (ch === "'" || ch === '"') {
      const quote = ch;
      const start = i;
      i += 1;
      while (i < code.length && code[i] !== quote) {
        if (code[i] === "\\") i += 1;
        i += 1;
      }
      i += 1;
      out += `""${newlinesIn(code.slice(start, i))}`;
      continue;
    }
    if (ch === "`") {
      i += 1;
      while (i < code.length && code[i] !== "`") {
        if (code[i] === "\\") {
          i += 2;
          continue;
        }
        if (code[i] === "\n") {
          out += "\n";
          i += 1;
          continue;
        }
        if (code[i] === "$" && code[i + 1] === "{") {
          let depth = 1;
          i += 2;
          const start = i;
          while (i < code.length && depth > 0) {
            if (code[i] === "{") depth += 1;
            if (code[i] === "}") depth -= 1;
            i += 1;
          }
          out += ` ${code.slice(start, i - 1)} `;
          continue;
        }
        i += 1;
      }
      i += 1;
      continue;
    }

    out += ch;
    i += 1;
  }

  return out;
}

/** Collect `const log = console.error` / `const { error: log } = console`. */
function consoleAliases(code) {
  const aliases = new Set();
  const direct = /(?:const|let|var)\s+(\w+)\s*=\s*console\s*\.\s*(\w+)/g;
  const destructured = /(?:const|let|var)\s*\{([^}]*)\}\s*=\s*console\b/g;

  let match;
  while ((match = direct.exec(code)) !== null) {
    if (SINK_METHODS.includes(match[2])) aliases.add(match[1]);
  }
  while ((match = destructured.exec(code)) !== null) {
    for (const part of match[1].split(",")) {
      const [name, alias] = part.split(":").map((s) => s.trim());
      if (!name) continue;
      if (SINK_METHODS.includes(name)) aliases.add(alias || name);
    }
  }

  return aliases;
}

/** Read the balanced argument list starting at the open paren index. */
function readArguments(code, openParen) {
  let depth = 0;
  for (let i = openParen; i < code.length; i += 1) {
    if (code[i] === "(") depth += 1;
    else if (code[i] === ")") {
      depth -= 1;
      if (depth === 0) return { text: code.slice(openParen + 1, i), end: i };
    }
  }
  return { text: code.slice(openParen + 1), end: code.length };
}

// Helpers from addon/utils/logError.js that return an already redacted string.
const SANITIZERS = /\b(?:redactUrl|formatError|logError|logWarning)\s*\(/;

/** Remove sanitizer-wrapped expressions: those are already redacted. */
function stripSanitizedCalls(text) {
  let out = text;
  for (;;) {
    const at = out.search(SANITIZERS);
    if (at === -1) return out;
    const open = out.indexOf("(", at);
    const { end } = readArguments(out, open);
    out = out.slice(0, at) + " " + out.slice(end + 1);
  }
}

function sinkPattern(aliases) {
  const names = [
    String.raw`console\s*\.\s*(?:${SINK_METHODS.join("|")})`,
    String.raw`(?:logger|log)\s*\.\s*(?:${SINK_METHODS.join("|")})`,
    String.raw`util\s*\.\s*inspect`,
    String.raw`JSON\s*\.\s*stringify`,
    ...[...aliases].map((alias) => String.raw`\b${alias}\b`),
  ];
  return new RegExp(String.raw`(?:${names.join("|")})\s*\(`, "g");
}

const CALLBACK_SINK = new RegExp(
  String.raw`\.\s*(?:catch|then|finally)\s*\([^)]*\bconsole\s*\.\s*(?:${SINK_METHODS.join("|")})\b[^)]*\)`,
  "g"
);

function scanSource(code, label) {
  const violations = [];
  const stripped = stripLiterals(code);
  const originalLines = code.split("\n");
  const pattern = sinkPattern(consoleAliases(stripped));

  let callback;
  while ((callback = CALLBACK_SINK.exec(stripped)) !== null) {
    const line = stripped.slice(0, callback.index).split("\n").length;
    const here = originalLines[line - 1] || "";
    const above = originalLines[line - 2] || "";
    if (OPT_OUT_WITH_REASON.test(here) || OPT_OUT_WITH_REASON.test(above)) continue;
    violations.push(
      `${label}:${line}: a console method is passed straight to ${callback[0].trim().split("(")[0]}(), so it receives the raw rejection\n    ${here.trim()}`
    );
  }

  let match;
  while ((match = pattern.exec(stripped)) !== null) {
    const openParen = match.index + match[0].length - 1;
    const { text } = readArguments(stripped, openParen);
    const unsanitized = stripSanitizedCalls(text);
    if (!ERROR_REFERENCE.test(unsanitized)) continue;

    const line = stripped.slice(0, match.index).split("\n").length;
    const here = originalLines[line - 1] || "";
    const above = originalLines[line - 2] || "";

    if (OPT_OUT_WITH_REASON.test(here) || OPT_OUT_WITH_REASON.test(above)) continue;
    if (here.includes(OPT_OUT) || above.includes(OPT_OUT)) {
      violations.push(`${label}:${line}: ${OPT_OUT} marker without a reason (use "${OPT_OUT}: why")\n    ${here.trim()}`);
      continue;
    }

    const reference = unsanitized.match(ERROR_REFERENCE)[0];
    violations.push(`${label}:${line}: error value "${reference}" reaches ${match[0].replace(/\s*\($/, "")}\n    ${here.trim()}`);
  }

  return violations;
}

function collectFiles(dir, acc) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      collectFiles(path.join(dir, entry.name), acc);
    } else if (entry.isFile()) {
      const name = entry.name;
      if (name.includes(".test.")) continue;
      if (name.endsWith(".d.ts")) continue;
      if (SCANNED_EXTENSIONS.some((ext) => name.endsWith(ext))) acc.push(path.join(dir, name));
    }
  }
  return acc;
}

function sourceFiles() {
  const files = [];
  for (const dir of SCAN_DIRS) collectFiles(path.join(ROOT, dir), files);

  // Root level scripts, but not the build tooling config in configure/.
  for (const entry of fs.readdirSync(ROOT, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (entry.name.includes(".test.") || entry.name.endsWith(".d.ts")) continue;
    if (!SCANNED_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) continue;
    files.push(path.join(ROOT, entry.name));
  }

  return files;
}

function scanFiles(files) {
  return files.flatMap((file) => scanSource(fs.readFileSync(file, "utf8"), path.relative(ROOT, file)));
}

function withFixture(source, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "logsafety-"));
  const file = path.join(dir, "fixture.js");
  fs.writeFileSync(file, source);
  try {
    return fn(scanFiles([file]));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("no error value reaches a logging sink unsanitized", () => {
  const files = sourceFiles();
  assert.ok(files.length > 20, `expected to scan the server side tree, only found ${files.length} files`);

  const violations = scanFiles(files);
  assert.deepStrictEqual(
    violations,
    [],
    `Error values must go through logError() from addon/utils/logError.js.\n` +
      `Axios attaches the request config - api_key, Authorization headers, client_secret - ` +
      `to its errors, and provider or proxy failures can embed credentials in .message and .stack too.\n` +
      `Annotate a line with "${OPT_OUT}: <reason>" if it is genuinely safe.\n\n${violations.join("\n")}`
  );
});

test("the guard catches every shape of raw sink", () => {
  const cases = {
    "bare catch handler": "h().catch(console.error);",
    "error as first argument": "try { f(); } catch (error) { console.error(error); }",
    "error as later argument": "try { f(); } catch (error) { console.error('boom:', error); }",
    "message property": "try { f(); } catch (error) { console.error('boom:', error.message); }",
    "stack property": "try { f(); } catch (e) { console.error(e.stack); }",
    "optional chaining": "try { f(); } catch (e) { console.error(e?.response?.data); }",
    "template interpolation": "try { f(); } catch (e) { console.error(`boom: ${e.message}`); }",
    "console.dir": "try { f(); } catch (error) { console.dir(error); }",
    "util.inspect": "try { f(); } catch (error) { console.log(util.inspect(error)); }",
    "JSON.stringify": "try { f(); } catch (error) { console.log(JSON.stringify(error)); }",
    "logger wrapper": "try { f(); } catch (error) { logger.error('boom', error); }",
    "assigned alias": "const log = console.error;\ntry { f(); } catch (error) { log(error); }",
    "destructured alias": "const { error: log } = console;\ntry { f(); } catch (e) { log('boom', e); }",
    "multiline call": "try { f(); } catch (error) {\n  console.error(\n    'boom:',\n    error.message\n  );\n}",
  };

  for (const [name, source] of Object.entries(cases)) {
    withFixture(source, (violations) => {
      assert.ok(violations.length >= 1, `guard missed the ${name} case`);
    });
  }
});

test("the guard does not flag sanitized or credential-free logging", () => {
  const clean = [
    "logError('op failed', error, { tmdbId });",
    "console.error(`no episodes for group ${groupId}`);",
    "console.log('Addon active on port ' + PORT);",
    "console.error(redactUrl(error.message));",
    "const monkey = 1; console.log('monkey', monkey);",
  ].join("\n");

  withFixture(clean, (violations) => {
    assert.deepStrictEqual(violations, []);
  });
});

test("the opt-out requires a written reason", () => {
  withFixture(`console.error('boom:', error); // ${OPT_OUT}: status only, no config`, (violations) => {
    assert.deepStrictEqual(violations, []);
  });

  withFixture(`console.error('boom:', error); // ${OPT_OUT}`, (violations) => {
    assert.strictEqual(violations.length, 1);
    assert.match(violations[0], /marker without a reason/);
  });

  withFixture(`// ${OPT_OUT}: vetted upstream\nconsole.error('boom:', error);`, (violations) => {
    assert.deepStrictEqual(violations, []);
  });
});

test("the guard scans root level scripts as well as addon/", () => {
  const scanned = sourceFiles().map((file) => path.relative(ROOT, file));
  assert.ok(scanned.includes("test-proxy.js"), "root scripts must be scanned");
  assert.ok(
    scanned.some((file) => file.startsWith("addon/")),
    "the addon tree must be scanned"
  );
  assert.ok(
    !scanned.some((file) => file.startsWith("configure/")),
    "configure/ is the browser bundle and is deliberately out of scope"
  );
});
