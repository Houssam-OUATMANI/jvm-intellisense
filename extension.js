const vscode = require("vscode");
const { execFile } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

let selectedJdk;

const execJava = (executable, args) => new Promise((resolve, reject) => {
  execFile(
    executable,
    args,
    { timeout: 15000, maxBuffer: 16 * 1024 * 1024, windowsHide: true },
    (error, stdout, stderr) => {
      const output = `${stdout || ""}${stderr || ""}`.trim();
      if (error) {
        const detail = output ? `\n${output}` : "";
        reject(new Error(`Java exited with ${error.code || error.message}.${detail}`));
        return;
      }
      resolve(output);
    }
  );
});

function resolveJavaExecutable(candidate) {
  if (!candidate) {
    return undefined;
  }
  const resolved = path.resolve(candidate.trim().replace(/^"(.*)"$/, "$1"));
  const executableName = process.platform === "win32" ? "java.exe" : "java";
  if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
    return resolved;
  }
  if (path.extname(resolved).toLowerCase() === (process.platform === "win32" ? ".exe" : "")) {
    return resolved;
  }
  return path.join(resolved, "bin", executableName);
}

function pathCandidates() {
  const executableName = process.platform === "win32" ? "java.exe" : "java";
  return (process.env.PATH || "")
    .split(path.delimiter)
    .filter(Boolean)
    .map(directory => path.join(directory, executableName));
}

function parseJdkFlags(output) {
  const flags = new Map();
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z][A-Za-z0-9_]*)\s+([A-Za-z][A-Za-z0-9_]*)\s*=\s*(.*?)\s+\{([^}]*)\}/);
    if (!match) {
      continue;
    }
    const [, type, name, defaultValue, origin] = match;
    flags.set(name, { type, defaultValue, origin });
  }
  return flags;
}

async function loadJdk(candidate) {
  const executable = resolveJavaExecutable(candidate);
  if (!executable) {
    throw new Error("Enter a Java executable path or a JDK home directory.");
  }
  const version = await execJava(executable, ["-version"]);
  const flagOutput = await execJava(executable, [
    "-XX:+UnlockDiagnosticVMOptions",
    "-XX:+PrintFlagsFinal",
    "-version"
  ]);
  const flags = parseJdkFlags(flagOutput);
  if (flags.size === 0) {
    throw new Error(`Could not read JVM flags from ${executable}.`);
  }
  return {
    executable,
    version: version.split(/\r?\n/)[0],
    flags
  };
}

function javaFlagType(type) {
  if (type === "bool") {
    return "Boolean";
  }
  if (/^(?:uintx|size_t|uint64_t)$/.test(type)) {
    return "Integer or memory size";
  }
  if (/^(?:u?int|intx|int64_t)$/.test(type)) {
    return "Integer";
  }
  if (/^(?:double|float)$/.test(type)) {
    return "Number";
  }
  if (/^(?:ccstr|ccstrlist)$/.test(type)) {
    return "String";
  }
  return type;
}

function getXXOption(name) {
  const staticOption = optionByXXName.get(name);
  const flag = selectedJdk && selectedJdk.flags.get(name);
  if (!flag) {
    return staticOption;
  }
  return {
    ...(staticOption || {}),
    label: staticOption ? staticOption.label : `-XX:${name}`,
    type: staticOption ? staticOption.type : javaFlagType(flag.type),
    description: staticOption
      ? staticOption.description
      : `Flag reported by the selected JDK (default: ${flag.defaultValue}; ${flag.origin}).`,
    defaultValue: flag.defaultValue,
    jdkFlag: true,
    values: staticOption && staticOption.values
  };
}

async function detectJdk() {
  const configuredPath = vscode.workspace.getConfiguration("jvmIntelliSense").get("javaPath", "").trim();
  if (configuredPath) {
    return loadJdk(configuredPath);
  }

  const candidates = [];
  if (process.env.JAVA_HOME) {
    candidates.push(process.env.JAVA_HOME);
  }
  candidates.push(...pathCandidates().filter(candidate => fs.existsSync(candidate)));
  const errors = [];
  for (const candidate of [...new Set(candidates)]) {
    try {
      return await loadJdk(candidate);
    } catch (error) {
      errors.push(`${candidate}: ${error.message}`);
    }
  }
  if (errors.length > 0) {
    throw new Error(`Java was found but could not be queried.\n${errors.join("\n")}`);
  }
  return undefined;
}

function getJdkCompletionOptions() {
  const staticOptions = selectedJdk
    ? options.filter(option => {
      if (!option.label.startsWith("-XX:")) {
        return true;
      }
      const name = option.label.slice(4).replace(/^[+-]/, "").replace(/=$/, "");
      return selectedJdk.flags.has(name);
    })
    : options;
  if (!selectedJdk) {
    return staticOptions;
  }

  const dynamicOptions = [];
  for (const [name, flag] of selectedJdk.flags) {
    if (optionByXXName.has(name)) {
      continue;
    }
    const type = javaFlagType(flag.type);
    if (type === "Boolean") {
      for (const sign of ["+", "-"]) {
        dynamicOptions.push({
          label: `-XX:${sign}${name}`,
          insertText: `-XX:${sign}${name}`,
          description: `Flag reported by ${selectedJdk.version} (default: ${flag.defaultValue}; ${flag.origin}).`,
          type
        });
      }
    } else {
      dynamicOptions.push({
        label: `-XX:${name}=`,
        insertText: `-XX:${name}=`,
        description: `Flag reported by ${selectedJdk.version} (default: ${flag.defaultValue}; ${flag.origin}).`,
        type
      });
    }
  }
  return [...staticOptions, ...dynamicOptions];
}

const options = [
  {
    label: "-XX:+UnlockDiagnosticVMOptions",
    insertText: "-XX:+UnlockDiagnosticVMOptions",
    description: "Enable diagnostic JVM options. This must precede diagnostic flags that require unlocking.",
    type: "Boolean"
  },
  {
    label: "-XX:+UseG1GC",
    insertText: "-XX:+UseG1GC",
    description: "Use the G1 garbage collector.",
    type: "Boolean"
  },
  {
    label: "-XX:+UseZGC",
    insertText: "-XX:+UseZGC",
    description: "Use the Z Garbage Collector. Availability depends on the JDK version and build.",
    type: "Boolean"
  },
  {
    label: "-XX:+UseParallelGC",
    insertText: "-XX:+UseParallelGC",
    description: "Use the parallel (throughput) garbage collector.",
    type: "Boolean"
  },
  {
    label: "-XX:+UseSerialGC",
    insertText: "-XX:+UseSerialGC",
    description: "Use the serial garbage collector.",
    type: "Boolean"
  },
  {
    label: "-XX:+UseShenandoahGC",
    insertText: "-XX:+UseShenandoahGC",
    description: "Use the Shenandoah garbage collector. Availability depends on the JDK build.",
    type: "Boolean"
  },
  {
    label: "-XX:+AlwaysPreTouch",
    insertText: "-XX:+AlwaysPreTouch",
    description: "Touch every page of the Java heap during JVM initialization.",
    type: "Boolean"
  },
  {
    label: "-XX:+DisableExplicitGC",
    insertText: "-XX:+DisableExplicitGC",
    description: "Ignore explicit garbage collection requests such as System.gc().",
    type: "Boolean"
  },
  {
    label: "-XX:+ExitOnOutOfMemoryError",
    insertText: "-XX:+ExitOnOutOfMemoryError",
    description: "Exit the JVM when the first out-of-memory error is thrown.",
    type: "Boolean"
  },
  {
    label: "-XX:+HeapDumpOnOutOfMemoryError",
    insertText: "-XX:+HeapDumpOnOutOfMemoryError",
    description: "Write a heap dump when an out-of-memory error occurs.",
    type: "Boolean"
  },
  {
    label: "-XX:+UseStringDeduplication",
    insertText: "-XX:+UseStringDeduplication",
    description: "Deduplicate identical String objects. Supported by selected garbage collectors.",
    type: "Boolean"
  },
  {
    label: "-XX:ActiveProcessorCount=",
    insertText: "-XX:ActiveProcessorCount=",
    description: "Override the number of processors the JVM uses when sizing pools.",
    type: "Integer",
    values: ["1", "2", "4", "8"]
  },
  {
    label: "-XX:MaxRAMPercentage=",
    insertText: "-XX:MaxRAMPercentage=",
    description: "Maximum percentage of available memory used for the Java heap.",
    type: "Percentage",
    values: ["25", "50", "75", "100"]
  },
  {
    label: "-XX:InitialRAMPercentage=",
    insertText: "-XX:InitialRAMPercentage=",
    description: "Initial percentage of available memory used for the Java heap.",
    type: "Percentage",
    values: ["10", "25", "50"]
  },
  {
    label: "-XX:MaxMetaspaceSize=",
    insertText: "-XX:MaxMetaspaceSize=",
    description: "Set the maximum size of the class metadata space.",
    type: "Memory size",
    values: ["128m", "256m", "512m", "1g"]
  },
  {
    label: "-XX:ThreadStackSize=",
    insertText: "-XX:ThreadStackSize=",
    description: "Set the thread stack size in kilobytes.",
    type: "Integer (kilobytes)",
    values: ["512", "1024", "2048"]
  },
  {
    label: "-Xms",
    insertText: "-Xms",
    description: "Set the initial Java heap size.",
    type: "Memory size",
    values: ["256m", "512m", "1g", "2g", "4g"]
  },
  {
    label: "-Xmx",
    insertText: "-Xmx",
    description: "Set the maximum Java heap size.",
    type: "Memory size",
    values: ["512m", "1g", "2g", "4g", "8g"]
  },
  {
    label: "-Xss",
    insertText: "-Xss",
    description: "Set the thread stack size.",
    type: "Memory size",
    values: ["256k", "512k", "1m", "2m"]
  },
  {
    label: "-Xlog:gc*",
    insertText: "-Xlog:gc*",
    description: "Configure unified JVM logging for garbage collection.",
    type: "Logging selector"
  },
  {
    label: "-D",
    insertText: "-D${1:property}=${2:value}",
    description: "Set a system property using -Dname=value.",
    type: "String",
    snippet: true
  },
  {
    label: "-cp",
    insertText: "-cp",
    description: "Set the user class path. Usually followed by a path list and the main class.",
    type: "Path"
  },
  {
    label: "--class-path",
    insertText: "--class-path",
    description: "Set the user class path.",
    type: "Path"
  },
  {
    label: "--module-path",
    insertText: "--module-path",
    description: "Set the module path.",
    type: "Path"
  },
  {
    label: "--upgrade-module-path",
    insertText: "--upgrade-module-path",
    description: "Set the upgrade module path.",
    type: "Path"
  },
  {
    label: "--add-modules",
    insertText: "--add-modules",
    description: "Add root modules to the initial module graph.",
    type: "Module name(s)"
  },
  {
    label: "--enable-preview",
    insertText: "--enable-preview",
    description: "Enable preview language and VM features for the current release.",
    type: "Boolean"
  },
  {
    label: "--add-opens",
    insertText: "--add-opens",
    description: "Allow reflective access to a package in a module.",
    type: "module/package=target-module"
  },
  {
    label: "-jar",
    insertText: "-jar",
    description: "Launch an application from a JAR file.",
    type: "JAR path"
  },
  {
    label: "-m",
    insertText: "-m",
    description: "Launch the main class of a module.",
    type: "module[/main-class]"
  }
];

const optionByXXName = new Map(
  options
    .filter(option => option.label.startsWith("-XX:"))
    .map(option => [option.label.slice(4).replace(/^[+-]/, "").replace(/=$/, ""), option])
);
const valueOptions = new Map(
  options
    .filter(option => option.values)
    .map(option => [option.label.replace(/=$/, ""), option])
);

function getToken(document, position) {
  const line = document.lineAt(position.line).text;
  const beforeCursor = line.slice(0, position.character);
  if (/^\s*#/.test(beforeCursor)) {
    return undefined;
  }

  let start = position.character;
  let end = position.character;
  while (start > 0 && !/\s/.test(line[start - 1])) {
    start--;
  }
  while (end < line.length && !/\s/.test(line[end])) {
    end++;
  }
  if (line.slice(0, start).trimStart().startsWith("#")) {
    return undefined;
  }

  return {
    text: line.slice(start, end),
    range: new vscode.Range(position.line, start, position.line, end),
    before: line.slice(0, start)
  };
}

function makeCompletion(option, range, suffix = "") {
  const item = new vscode.CompletionItem(option.label, vscode.CompletionItemKind.Property);
  item.detail = `Type: ${option.type}`;
  item.documentation = new vscode.MarkdownString(option.description);
  item.insertText = option.snippet
    ? new vscode.SnippetString(option.insertText)
    : `${option.insertText}${suffix}`;
  item.range = range;
  item.sortText = option.label;
  return item;
}

function getValueCompletions(token, range) {
  let option;
  let typedValue = "";
  let prefix = "";

  const xxMatch = token.match(/^(-XX:([A-Za-z][A-Za-z0-9_.-]*)=)(.*)$/);
  if (xxMatch) {
    option = getXXOption(xxMatch[2]);
    prefix = xxMatch[1];
    typedValue = xxMatch[3];
  } else {
    const xMatch = token.match(/^(-Xm[sx]|-Xss)(.*)$/);
    if (xMatch) {
      option = valueOptions.get(xMatch[1]);
      prefix = xMatch[1];
      typedValue = xMatch[2];
    }
  }

  if (!option || !option.values) {
    return undefined;
  }

  return option.values
    .filter(value => value.toLowerCase().startsWith(typedValue.toLowerCase()))
    .map(value => {
      const item = new vscode.CompletionItem(value, vscode.CompletionItemKind.Value);
      item.detail = `${option.label} value (${option.type})`;
      item.documentation = new vscode.MarkdownString(option.description);
      item.textEdit = vscode.TextEdit.replace(range, `${prefix}${value}`);
      return item;
    });
}

function provideCompletions(document, position) {
  const token = getToken(document, position);
  if (!token) {
    return [];
  }

  const valueCompletions = getValueCompletions(token.text, token.range);
  if (valueCompletions) {
    return valueCompletions;
  }

  if (!token.text.startsWith("-")) {
    return [];
  }
  const typed = token.text.toLowerCase();
  return getJdkCompletionOptions()
    .filter(option => option.label.toLowerCase().startsWith(typed))
    .map(option => makeCompletion(option, token.range));
}

function findOption(token) {
  if (token.startsWith("-XX:")) {
    const name = token.slice(4).replace(/^[+-]/, "").split("=")[0];
    return getXXOption(name);
  }
  const exact = options.find(option => option.label === token);
  if (exact) {
    return exact;
  }
  if (/^-D[^=]*=?$/.test(token)) {
    return {
      label: "-Dname=value",
      type: "String",
      description: "Set a system property. The property name and value are application-specific."
    };
  }
  if (/^-Xm[sx]|^-Xss/.test(token)) {
    return valueOptions.get(token.match(/^-Xm[sx]|^-Xss/)[0]);
  }
  return undefined;
}

function provideHover(document, position) {
  const token = getToken(document, position);
  if (!token || !token.text) {
    return undefined;
  }
  const option = findOption(token.text);
  if (!option) {
    return undefined;
  }
  const contents = new vscode.MarkdownString();
  contents.appendCodeblock(option.label, "text");
  contents.appendMarkdown(`**Type:** ${option.type}\n\n${option.description}`);
  if (option.values) {
    contents.appendMarkdown(`\n\n**Example values:** ${option.values.join(", ")}`);
  }
  if (option.label.startsWith("-XX:") || option.label.startsWith("-X")) {
    contents.appendMarkdown("\n\nAvailability and defaults may vary by JDK version and vendor.");
  }
  return new vscode.Hover(contents, token.range);
}

function tokenizeLine(line, lineNumber, diagnostics) {
  const tokens = [];
  let index = 0;
  while (index < line.length && /\s/.test(line[index])) {
    index++;
  }
  if (line[index] === "#") {
    return tokens;
  }

  while (index < line.length) {
    while (index < line.length && /\s/.test(line[index])) {
      index++;
    }
    if (index >= line.length) {
      break;
    }

    const start = index;
    let value = "";
    let quote;
    while (index < line.length) {
      const character = line[index];
      if (quote) {
        if (character === quote) {
          quote = undefined;
        } else if (character === "\\" && index + 1 < line.length) {
          index++;
          value += line[index];
        } else {
          value += character;
        }
        index++;
      } else if (character === "\"" || character === "'") {
        quote = character;
        index++;
      } else if (/\s/.test(character)) {
        break;
      } else {
        value += character;
        index++;
      }
    }

    const range = new vscode.Range(lineNumber, start, lineNumber, index);
    if (quote) {
      diagnostics.push(new vscode.Diagnostic(
        range,
        "Unterminated quoted argument.",
        vscode.DiagnosticSeverity.Error
      ));
    }
    tokens.push({ value, range });
  }
  return tokens;
}

function addDiagnostic(diagnostics, token, message, severity) {
  diagnostics.push(new vscode.Diagnostic(token.range, message, severity));
}

function validateMemorySize(value) {
  return /^[0-9]+(?:[kKmMgGtT])?$/.test(value) && Number.parseInt(value, 10) > 0;
}

function validateXXOption(token, diagnostics) {
  const match = token.value.match(/^-XX:([+-]?)([A-Za-z][A-Za-z0-9_.-]*)(?:=(.*))?$/);
  if (!match) {
    addDiagnostic(
      diagnostics,
      token,
      "Malformed -XX option; expected -XX:+Flag, -XX:-Flag, or -XX:Name=value.",
      vscode.DiagnosticSeverity.Error
    );
    return;
  }

  const [, sign, name, value] = match;
  if (selectedJdk && !selectedJdk.flags.has(name)) {
    addDiagnostic(
      diagnostics,
      token,
      `-XX:${name} was not reported by the selected JDK (${selectedJdk.version}).`,
      vscode.DiagnosticSeverity.Information
    );
    return;
  }
  const option = getXXOption(name);
  if (!option) {
    addDiagnostic(
      diagnostics,
      token,
      `Not in the built-in option catalog: -XX:${name}. Its availability depends on the selected JDK and vendor.`,
      vscode.DiagnosticSeverity.Information
    );
    return;
  }

  if (option.type === "Boolean") {
    if (!sign || value !== undefined) {
      addDiagnostic(
        diagnostics,
        token,
        `-XX:${name} is a boolean flag; use -XX:+${name} or -XX:-${name}.`,
        vscode.DiagnosticSeverity.Error
      );
    }
    return;
  }

  if (sign || value === undefined || value.length === 0) {
    addDiagnostic(
      diagnostics,
      token,
      `-XX:${name} requires a value using -XX:${name}=value.`,
      vscode.DiagnosticSeverity.Error
    );
    return;
  }

  let valid = true;
  if (option.type === "Integer" || option.type === "Integer (kilobytes)") {
    valid = /^[0-9]+$/.test(value) && Number(value) > 0;
  } else if (option.type === "Integer or memory size") {
    valid = /^[0-9]+(?:[kKmMgGtT])?$/.test(value) && Number.parseInt(value, 10) > 0;
  } else if (option.type === "Percentage") {
    valid = /^(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)$/.test(value) && Number(value) > 0;
  } else if (option.type === "Memory size") {
    valid = validateMemorySize(value);
  } else if (option.type === "Number") {
    valid = value.trim() !== "" && Number.isFinite(Number(value));
  } else if (option.type === "String") {
    valid = value.length > 0;
  }
  if (!valid) {
    addDiagnostic(
      diagnostics,
      token,
      `Invalid value "${value}" for -XX:${name} (${option.type}).`,
      vscode.DiagnosticSeverity.Error
    );
  }
}

function validateToken(token, diagnostics) {
  const value = token.value;
  if (value.startsWith("-XX:")) {
    validateXXOption(token, diagnostics);
    return;
  }
  if (/^-D/.test(value)) {
    if (!/^-D[^=\s]+(?:=.*)?$/.test(value)) {
      addDiagnostic(
        diagnostics,
        token,
        "A system property must have a non-empty name, for example -Dname=value.",
        vscode.DiagnosticSeverity.Error
      );
    }
    return;
  }

  const memoryMatch = value.match(/^(-Xm[sx]|-Xss)(.*)$/);
  if (memoryMatch) {
    if (!memoryMatch[2] || !validateMemorySize(memoryMatch[2])) {
      addDiagnostic(
        diagnostics,
        token,
        `${memoryMatch[1]} requires a positive size such as 512m or 2g.`,
        vscode.DiagnosticSeverity.Error
      );
    }
    return;
  }

  if (/^-X[A-Za-z]/.test(value) && !options.some(option =>
    option.label === value || (option.label === "-Xlog:gc*" && value.startsWith("-Xlog:"))
  )) {
    addDiagnostic(
      diagnostics,
      token,
      `Not in the built-in option catalog: ${value}. Its availability depends on the selected JDK and vendor.`,
      vscode.DiagnosticSeverity.Information
    );
    return;
  }

  if (/^--?[A-Za-z]/.test(value)) {
    const optionName = value.split("=")[0];
    if (!options.some(option => option.label.replace(/=$/, "") === optionName)) {
      addDiagnostic(
        diagnostics,
        token,
        `Not in the built-in option catalog: ${optionName}. It may be JDK- or vendor-specific.`,
        vscode.DiagnosticSeverity.Information
      );
    }
  }
}

function validateDocument(document) {
  const diagnostics = [];
  const occurrences = new Map();
  const enabledCollectors = [];

  for (let lineNumber = 0; lineNumber < document.lineCount; lineNumber++) {
    const lineDiagnostics = [];
    const tokens = tokenizeLine(document.lineAt(lineNumber).text, lineNumber, lineDiagnostics);
    diagnostics.push(...lineDiagnostics);

    for (const token of tokens) {
      validateToken(token, diagnostics);

      let key;
      if (/^-XX:[+-]/.test(token.value)) {
        key = `-XX:${token.value.slice(5).split("=")[0]}`;
        const collector = token.value.match(/^-XX:\+(Use(?:G1|Z|Parallel|Serial|Shenandoah)GC)$/);
        if (collector) {
          enabledCollectors.push({ token, name: collector[1] });
        }
      } else if (/^-XX:[A-Za-z]/.test(token.value)) {
        key = `-XX:${token.value.slice(4).split("=")[0]}`;
      } else if (/^-Xm[sx]/.test(token.value)) {
        key = token.value.match(/^-Xm[sx]/)[0];
      } else if (/^-Xss/.test(token.value)) {
        key = "-Xss";
      } else if (/^-D[^=]+/.test(token.value)) {
        key = token.value.split("=")[0];
      }

      if (key) {
        const previous = occurrences.get(key);
        if (previous) {
          addDiagnostic(
            diagnostics,
            token,
            `${key} is specified more than once; the effective value may depend on argument order.`,
            vscode.DiagnosticSeverity.Warning
          );
        } else {
          occurrences.set(key, token);
        }
      }
    }
  }

  const seenCollectors = new Set();
  for (const { token, name } of enabledCollectors) {
    if (seenCollectors.size > 0 && !seenCollectors.has(name)) {
      addDiagnostic(
        diagnostics,
        token,
        "Multiple garbage collectors are explicitly enabled; choose a single collector.",
        vscode.DiagnosticSeverity.Warning
      );
    }
    seenCollectors.add(name);
  }
  return diagnostics;
}

function getJvmArguments(document) {
  const tokens = [];
  for (let lineNumber = 0; lineNumber < document.lineCount; lineNumber++) {
    tokens.push(...tokenizeLine(document.lineAt(lineNumber).text, lineNumber, []));
  }

  const argumentsToValidate = [];
  const optionsWithValues = new Set([
    "--add-modules",
    "--add-exports",
    "--add-opens",
    "--add-reads",
    "--enable-native-access",
    "--limit-modules",
    "--patch-module",
    "--upgrade-module-path",
    "--module-path",
    "--class-path",
    "-classpath",
    "-cp",
    "-p"
  ]);
  for (let index = 0; index < tokens.length; index++) {
    const value = tokens[index].value;
    if (value.startsWith("@") || ["-jar", "-m", "--module", "--source"].includes(value)) {
      break;
    }
    if (!value.startsWith("-")) {
      break;
    }
    if (["-version", "-showversion", "--version", "--help", "--help-extra", "-help", "-?"].includes(value)) {
      break;
    }
    argumentsToValidate.push(value);
    if (optionsWithValues.has(value) && index + 1 < tokens.length) {
      const nextValue = tokens[index + 1].value;
      if (!nextValue.startsWith("-")) {
        argumentsToValidate.push(tokens[++index].value);
      }
    }
  }
  return argumentsToValidate;
}

async function validateWithJava(document) {
  const diagnostics = validateDocument(document);
  if (diagnostics.some(diagnostic => diagnostic.severity === vscode.DiagnosticSeverity.Error)) {
    vscode.window.showWarningMessage("Fix the argument syntax errors before validating with Java.");
    return;
  }
  if (!selectedJdk) {
    vscode.window.showWarningMessage("No JDK is available. Use JVM IntelliSense: Select JDK first.");
    return;
  }

  const javaArguments = getJvmArguments(document);
  if (javaArguments.length === 0) {
    vscode.window.showInformationMessage("No JVM options were found to validate.");
    return;
  }

  const confirmation = await vscode.window.showWarningMessage(
    "This runs the selected Java executable with the JVM options in this file. Java agents or native agents may execute code. @files and application launch arguments are not expanded or run.",
    "Validate",
    "Cancel"
  );
  if (confirmation !== "Validate") {
    return;
  }

  try {
    await execJava(selectedJdk.executable, [...javaArguments, "-version"]);
    vscode.window.showInformationMessage(`JVM options accepted by ${selectedJdk.version}.`);
  } catch (error) {
    vscode.window.showErrorMessage(`Java rejected the JVM options: ${error.message.slice(0, 1200)}`);
  }
}

function activate(context) {
  const diagnosticCollection = vscode.languages.createDiagnosticCollection("jvm-args");
  const updateDiagnostics = document => {
    if (document.languageId === "jvm-args") {
      diagnosticCollection.set(document.uri, validateDocument(document));
    }
  };
  const updateAllDiagnostics = () => {
    for (const document of vscode.workspace.textDocuments) {
      updateDiagnostics(document);
    }
  };
  const refreshJdk = async () => {
    selectedJdk = await detectJdk();
    updateAllDiagnostics();
  };
  context.subscriptions.push(
    diagnosticCollection,
    vscode.workspace.onDidOpenTextDocument(updateDiagnostics),
    vscode.workspace.onDidChangeTextDocument(event => updateDiagnostics(event.document)),
    vscode.workspace.onDidCloseTextDocument(document => diagnosticCollection.delete(document.uri))
  );
  for (const document of vscode.workspace.textDocuments) {
    updateDiagnostics(document);
  }

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration("jvmIntelliSense.javaPath")) {
        refreshJdk().catch(error => vscode.window.showErrorMessage(`Could not load the configured JDK: ${error.message}`));
      }
    }),
    vscode.commands.registerCommand("jvmIntelliSense.selectJdk", async () => {
      const configuration = vscode.workspace.getConfiguration("jvmIntelliSense");
      const candidate = await vscode.window.showInputBox({
        value: configuration.get("javaPath", "") || process.env.JAVA_HOME || "",
        prompt: "Enter the Java executable path or a JDK home directory.",
        placeHolder: process.platform === "win32" ? "C:\\Program Files\\Java\\jdk-..." : "/usr/lib/jvm/..."
      });
      if (!candidate || !candidate.trim()) {
        return;
      }
      try {
        const jdk = await loadJdk(candidate.trim());
        const target = vscode.workspace.workspaceFolders
          ? vscode.ConfigurationTarget.Workspace
          : vscode.ConfigurationTarget.Global;
        await configuration.update("javaPath", candidate.trim(), target);
        selectedJdk = jdk;
        updateAllDiagnostics();
        vscode.window.showInformationMessage(`Selected ${jdk.version} (${jdk.executable}); loaded ${jdk.flags.size} JVM flags.`);
      } catch (error) {
        vscode.window.showErrorMessage(`Could not select this JDK: ${error.message}`);
      }
    }),
    vscode.commands.registerCommand("jvmIntelliSense.validateOptions", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document.languageId !== "jvm-args") {
        vscode.window.showWarningMessage("Open a JVM arguments file before validating its options.");
        return;
      }
      await validateWithJava(editor.document);
    }),
    vscode.languages.registerCompletionItemProvider(
      { language: "jvm-args" },
      { provideCompletionItems: provideCompletions },
      "-",
      ":",
      "=",
      "+"
    ),
    vscode.languages.registerHoverProvider(
      { language: "jvm-args" },
      { provideHover }
    )
  );

  refreshJdk().catch(error => {
    vscode.window.showWarningMessage(`JDK auto-detection failed: ${error.message}`);
  });
}

function deactivate() {}

module.exports = {
  activate,
  deactivate,
  validateDocument,
  getJvmArguments,
  loadJdk,
  parseJdkFlags,
  resolveJavaExecutable
};
