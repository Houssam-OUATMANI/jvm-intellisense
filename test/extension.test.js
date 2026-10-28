const assert = require("node:assert/strict");
const { test } = require("node:test");
const Module = require("node:module");
const path = require("node:path");

const javaInvocations = [];
const childProcess = {
  execFile(executable, args, options, callback) {
    javaInvocations.push({ executable, args, options });
    if (args.includes("-XX:+PrintFlagsFinal")) {
      callback(null, [
        "     bool UnlockDiagnosticVMOptions                 = true                                      {diagnostic} {command line}",
        "     bool UseG1GC                                    = true                                      {product} {default}"
      ].join("\n"), "");
      return;
    }
    callback(null, "", 'java version "25.0.3"');
  }
};

const vscode = {
  Range: class Range {
    constructor(startLine, start, endLine, end) {
      Object.assign(this, { startLine, start, endLine, end });
    }
  },
  Diagnostic: class Diagnostic {
    constructor(range, message, severity) {
      Object.assign(this, { range, message, severity });
    }
  },
  DiagnosticSeverity: {
    Error: 0,
    Warning: 1,
    Information: 2
  }
};

const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === "vscode") {
    return vscode;
  }
  if (request === "node:child_process") {
    return childProcess;
  }
  return originalLoad.call(this, request, parent, isMain);
};
const {
  getJvmArguments,
  loadJdk,
  parseJdkFlags,
  resolveJavaExecutable,
  validateDocument
} = require("../extension");
Module._load = originalLoad;

function documentFrom(text) {
  const lines = text.split(/\r?\n/);
  return {
    lineCount: lines.length,
    lineAt: line => ({ text: lines[line] })
  };
}

test("parses JVM flags and ignores non-flag output", () => {
  const flags = parseJdkFlags([
    '   bool UseG1GC                                  = true                                      {product} {default}',
    '     uintx MaxHeapSize                           = 8589934592                                {product} {ergonomic}',
    '    double MaxRAMPercentage                      = 25.000000                                 {product} {default}',
    'java version "25.0.3"'
  ].join("\n"));

  assert.equal(flags.size, 3);
  assert.deepEqual(flags.get("UseG1GC"), {
    type: "bool",
    defaultValue: "true",
    origin: "product"
  });
  assert.equal(flags.get("MaxHeapSize").type, "uintx");
});

test("loads diagnostic flags by unlocking diagnostic options first", async () => {
  javaInvocations.length = 0;
  const jdk = await loadJdk(path.resolve(path.join(path.sep, "fake-jdk")));
  const flagInvocation = javaInvocations.find(invocation => invocation.args.includes("-XX:+PrintFlagsFinal"));

  assert.deepEqual(flagInvocation.args, [
    "-XX:+UnlockDiagnosticVMOptions",
    "-XX:+PrintFlagsFinal",
    "-version"
  ]);
  assert.equal(jdk.flags.has("UnlockDiagnosticVMOptions"), true);
  assert.equal(jdk.version, 'java version "25.0.3"');
});

test("reports invalid values and unterminated quotes as errors", () => {
  const diagnostics = validateDocument(documentFrom([
    "-Xmx0g",
    "-XX:MaxMetaspaceSize=nope",
    "-D=value",
    '"unterminated'
  ].join("\n")));

  assert.equal(diagnostics.filter(item => item.severity === vscode.DiagnosticSeverity.Error).length, 4);
});

test("reports repeated options and different explicitly enabled collectors", () => {
  const duplicate = validateDocument(documentFrom("-XX:+UseG1GC\n-XX:+UseG1GC"));
  assert(duplicate.some(item => item.severity === vscode.DiagnosticSeverity.Warning && item.message.includes("more than once")));
  assert(!duplicate.some(item => item.message.includes("Multiple garbage collectors")));

  const conflict = validateDocument(documentFrom("-XX:+UseG1GC\n-XX:+UseZGC"));
  assert(conflict.some(item => item.severity === vscode.DiagnosticSeverity.Warning && item.message.includes("Multiple garbage collectors")));
});

test("leaves uncatalogued options informational when no JDK is selected", () => {
  const diagnostics = validateDocument(documentFrom([
    "-XX:+VendorSpecificFlag",
    "-XX:NotInCatalog=value",
    "# -XX:+CommentedOutFlag"
  ].join("\n")));

  assert.equal(diagnostics.length, 2);
  assert(diagnostics.every(item => item.severity === vscode.DiagnosticSeverity.Information));
  assert(diagnostics.every(item => item.message.includes("Not in the built-in option catalog")));
});

test("accepts valid arguments and ignores comments and quoted spaces", () => {
  const diagnostics = validateDocument(documentFrom([
    "# Valid JVM options",
    '-Xmx1g -Dapp.message="hello world"',
    "-XX:ActiveProcessorCount=4",
    "-XX:+UseG1GC"
  ].join("\n")));

  assert.deepEqual(diagnostics, []);
});

test("extracts JVM options only and stops before application launch arguments", () => {
  const document = documentFrom([
    "-Xmx512m -Dapp.mode=prod",
    "--add-opens java.base/java.lang=ALL-UNNAMED",
    "-cp libs/* com.example.Main",
    "-XX:+UseG1GC"
  ].join("\n"));

  assert.deepEqual(getJvmArguments(document), [
    "-Xmx512m",
    "-Dapp.mode=prod",
    "--add-opens",
    "java.base/java.lang=ALL-UNNAMED",
    "-cp",
    "libs/*"
  ]);
});

test("does not expand @files or include application launch targets", () => {
  assert.deepEqual(
    getJvmArguments(documentFrom("-Xmx512m\n@shared.args\n-XX:+UseG1GC")),
    ["-Xmx512m"]
  );
  assert.deepEqual(
    getJvmArguments(documentFrom("--module-path modules -m sample/module.Main")),
    ["--module-path", "modules"]
  );
});

test("resolves JDK homes and preserves explicit Java executable paths", () => {
  const jdkHome = path.resolve(path.join(path.sep, "opt", "jdk"));
  assert.equal(
    resolveJavaExecutable(jdkHome),
    path.join(jdkHome, "bin", process.platform === "win32" ? "java.exe" : "java")
  );

  const executable = path.resolve(path.join(path.sep, "custom", process.platform === "win32" ? "java.exe" : "java"));
  assert.equal(resolveJavaExecutable(executable), executable);
});
