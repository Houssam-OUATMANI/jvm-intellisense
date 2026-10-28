const assert = require("node:assert/strict");
const { test } = require("node:test");
const Module = require("node:module");
const path = require("node:path");
const fs = require("node:fs");

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
      this.start = { line: startLine, character: start };
      this.end = { line: endLine, character: end };
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
  },
  Uri: {
    file(fsPath) {
      return {
        scheme: "file",
        fsPath,
        toString: () => `file://${fsPath}`
      };
    }
  },
  DocumentLink: class DocumentLink {
    constructor(range, target) {
      Object.assign(this, { range, target });
    }
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
  getArgumentFileReferences,
  getArgumentFileReferenceAtPosition,
  enableArgumentFileLanguage,
  isConfiguredArgumentFile,
  loadJdk,
  matchesConfiguredExtension,
  parseJavaMajorVersion,
  parseJdkFlags,
  provideArgumentFileLinks,
  resolveJavaExecutable,
  resolveArgumentFileUri,
  validateDocument,
  activate
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
  assert.equal(jdk.majorVersion, 25);
});

test("parses current and legacy Java version strings", () => {
  assert.equal(parseJavaMajorVersion('java version "1.8.0_402"'), 8);
  assert.equal(parseJavaMajorVersion('openjdk version "17.0.10" 2024-01-16'), 17);
  assert.equal(parseJavaMajorVersion('java version "25.0.3" 2026-04-21 LTS'), 25);
  assert.equal(parseJavaMajorVersion("Java version unavailable"), undefined);
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

test("classifies the removed CMS option using the selected Java version", () => {
  const flag = { type: "bool", defaultValue: "false", origin: "product" };
  const option = "-XX:+UseConcMarkSweepGC";
  const java8 = validateDocument(documentFrom(option), {
    executable: "java",
    version: 'java version "1.8.0_402"',
    majorVersion: 8,
    flags: new Map([["UseConcMarkSweepGC", flag]])
  });
  assert.deepEqual(java8, []);

  const java11 = validateDocument(documentFrom(option), {
    executable: "java",
    version: 'openjdk version "11.0.22"',
    majorVersion: 11,
    flags: new Map([["UseConcMarkSweepGC", flag]])
  });
  assert(java11.some(item =>
    item.severity === vscode.DiagnosticSeverity.Warning &&
    item.message.includes("deprecated in Java 9") &&
    item.message.includes("removed in Java 14")
  ));

  const java25 = validateDocument(documentFrom(option), {
    executable: "java",
    version: 'java version "25.0.3"',
    majorVersion: 25,
    flags: new Map()
  });
  assert.equal(java25.length, 1);
  assert.equal(java25[0].severity, vscode.DiagnosticSeverity.Error);
  assert(java25[0].message.includes("removed in Java 14"));
  assert(java25[0].message.includes("selected Java 25"));
});

test("warns that nested argument-file references are editor-only", () => {
  const diagnostics = validateDocument(documentFrom([
    "@child.args",
    "# @commented.args",
    "-Xmx1g"
  ].join("\n")));
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].severity, vscode.DiagnosticSeverity.Warning);
  assert(diagnostics[0].message.includes("not expanded by the Java launcher"));
  assert(diagnostics[0].message.includes("wrapper script"));
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

test("finds quoted and unquoted argument-file references but ignores comments", () => {
  const document = documentFrom([
    "@jvm-blaa",
    '@"config/extra args"',
    "# @ignored.args"
  ].join("\n"));
  const references = getArgumentFileReferences(document);

  assert.deepEqual(references.map(reference => reference.path), [
    "jvm-blaa",
    "config/extra args"
  ]);
  assert.equal(getArgumentFileReferenceAtPosition(document, { line: 0, character: 2 }).path, "jvm-blaa");
  assert.equal(getArgumentFileReferenceAtPosition(document, { line: 2, character: 4 }), undefined);
});

test("argument-file grammar uses visible theme-aware token scopes", () => {
  const grammar = require("../syntaxes/jvm-args.tmLanguage.json");
  const rule = grammar.repository["argument-files"].patterns[0];
  const match = new RegExp(rule.match).exec("@jvm-blaa");

  assert(match);
  assert.equal(rule.captures["1"].name, "keyword.control.import.jvm-args");
  assert.equal(rule.captures["4"].name, "string.other.link.jvm-args");
  assert.equal(match[1], "@");
  assert.equal(match[4], "jvm-blaa");
});

test("enables IntelliSense for referenced files without overriding another language", async () => {
  vscode.languages = {
    setTextDocumentLanguage: async (document, languageId) => ({
      ...document,
      languageId
    })
  };
  const plainTextDocument = { languageId: "plaintext" };
  const enabled = await enableArgumentFileLanguage(plainTextDocument);
  assert.equal(enabled.languageId, "jvm-args");

  const javaDocument = { languageId: "java" };
  assert.equal(await enableArgumentFileLanguage(javaDocument), javaDocument);
});

test("matches configurable extensions without overriding other language associations", () => {
  const defaults = [".args", ".jvmargs", ".vmoptions"];
  assert(matchesConfiguredExtension("C:\\workspace\\jvm.args", defaults));
  assert(matchesConfiguredExtension("C:\\workspace\\JAVA.JVMARGS", defaults));
  assert(!matchesConfiguredExtension("C:\\workspace\\settings.json", defaults));
  assert(matchesConfiguredExtension("C:\\workspace\\launch.jvmopts", [".jvmopts"]));
  assert(!matchesConfiguredExtension("C:\\workspace\\launch.jvmargs", [".jvmopts"]));
  assert(!matchesConfiguredExtension("C:\\workspace\\jvm.args", ["args", ".."]));

  const uri = { scheme: "file", fsPath: "C:\\workspace\\jvm.args" };
  assert(isConfiguredArgumentFile({ uri, languageId: "plaintext" }, defaults));
  assert(!isConfiguredArgumentFile({ uri, languageId: "java" }, defaults));
  assert(!isConfiguredArgumentFile({ uri: { ...uri, scheme: "untitled" }, languageId: "plaintext" }, defaults));
});

test("provides one navigation link spanning the full argument-file reference", async () => {
  const sourcePath = path.resolve(path.join(path.sep, "workspace", "jvm.args"));
  const targetPath = path.resolve(path.join(path.sep, "workspace", "config", "jvm-blaa"));
  const document = Object.assign(documentFrom("@config/jvm-blaa @other.args"), {
    uri: { scheme: "file", fsPath: sourcePath }
  });
  const uri = resolveArgumentFileUri(document, { path: "config/jvm-blaa" });
  assert.equal(uri.fsPath, targetPath);

  const statPaths = [];
  vscode.workspace = {
    fs: {
      stat: async target => {
        statPaths.push(target.fsPath);
      }
    }
  };
  const links = await provideArgumentFileLinks(document);
  assert.equal(links.length, 2);
  assert.equal(links[0].target.fsPath, targetPath);
  assert.equal(links[0].range.start.character, 0);
  assert.equal(links[0].range.end.character, "@config/jvm-blaa".length);
  assert.equal(links[0].tooltip, "Open argument file config/jvm-blaa");
  assert.deepEqual(statPaths, [
    targetPath,
    path.resolve(path.join(path.dirname(sourcePath), "other.args"))
  ]);
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

test("package metadata exposes customizable extensions and Marketplace icon", () => {
  const manifest = require("../package.json");
  const settings = manifest.contributes.configuration.properties;

  assert.equal(manifest.version, "0.1.0");
  assert.equal(manifest.license, "MIT");
  assert.equal(manifest.icon, "icon.png");
  const iconPath = path.join(__dirname, "..", manifest.icon);
  const icon = fs.readFileSync(iconPath);
  assert.equal(icon.toString("hex", 0, 8), "89504e470d0a1a0a");
  assert.equal(icon.readUInt32BE(16), 500);
  assert.equal(icon.readUInt32BE(20), 500);
  assert(manifest.keywords.includes("jvm"));
  assert(manifest.keywords.includes("java"));
  assert.deepEqual(settings["jvmIntelliSense.fileExtensions"].default, [
    ".args",
    ".jvmargs",
    ".vmoptions"
  ]);
  assert(!manifest.contributes.languages[0].extensions);
});

test("reapplies extension changes immediately and restores removed files to Plain Text", async () => {
  let extensions = [".args"];
  let configurationListener;
  let openDocumentListener;
  const documents = [
    { uri: vscode.Uri.file("C:\\workspace\\one.args"), languageId: "plaintext", lineCount: 0, lineAt: () => ({ text: "" }) },
    { uri: vscode.Uri.file("C:\\workspace\\two.blabla"), languageId: "plaintext", lineCount: 0, lineAt: () => ({ text: "" }) },
    { uri: vscode.Uri.file("C:\\workspace\\owned.args"), languageId: "java", lineCount: 1, lineAt: () => ({ text: "@one.args" }) }
  ];
  const diagnostics = new Map();
  vscode.languages = {
    setTextDocumentLanguage: async (document, languageId) => {
      document.languageId = languageId;
      return document;
    },
    createDiagnosticCollection: () => ({
      set: (uri, values) => diagnostics.set(uri.toString(), values),
      delete: uri => diagnostics.delete(uri.toString()),
      dispose() {}
    }),
    registerDocumentLinkProvider: () => ({ dispose() {} }),
    registerCompletionItemProvider: () => ({ dispose() {} }),
    registerHoverProvider: () => ({ dispose() {} })
  };
  vscode.workspace = {
    textDocuments: documents,
    workspaceFolders: undefined,
    getConfiguration: () => ({
      get: (name, fallback) => name === "fileExtensions" ? extensions : fallback,
      update: async () => {}
    }),
    onDidOpenTextDocument: listener => (openDocumentListener = listener, { dispose() {} }),
    onDidChangeTextDocument: () => ({ dispose() {} }),
    onDidCloseTextDocument: () => ({ dispose() {} }),
    onDidChangeConfiguration: listener => (configurationListener = listener, { dispose() {} }),
    fs: { stat: async () => {} },
    openTextDocument: async uri => documents.find(document => document.uri.toString() === uri.toString())
  };
  vscode.commands = { registerCommand: () => ({ dispose() {} }) };
  vscode.window = {
    showErrorMessage: message => { throw new Error(message); },
    showWarningMessage: () => {},
    showInformationMessage: () => {}
  };

  activate({ subscriptions: [] });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(documents[0].languageId, "jvm-args");
  assert.equal(documents[1].languageId, "plaintext");
  assert.equal(documents[2].languageId, "java");

  extensions = [".blabla"];
  configurationListener({ affectsConfiguration: name => name === "jvmIntelliSense.fileExtensions" });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(documents[0].languageId, "plaintext");
  assert.equal(documents[1].languageId, "jvm-args");
  assert.equal(documents[2].languageId, "java");
  assert.equal(diagnostics.has(documents[0].uri.toString()), false);

  extensions = [".args"];
  configurationListener({ affectsConfiguration: name => name === "jvmIntelliSense.fileExtensions" });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(documents[0].languageId, "jvm-args");
  assert.equal(documents[1].languageId, "plaintext");

  const opened = { uri: vscode.Uri.file("C:\\workspace\\three.args"), languageId: "plaintext", lineCount: 0, lineAt: () => ({ text: "" }) };
  documents.push(opened);
  openDocumentListener(opened);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(opened.languageId, "jvm-args");
});
