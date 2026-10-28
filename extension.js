const vscode = require("vscode");

const options = [
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
    option = optionByXXName.get(xxMatch[2]);
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
  return options
    .filter(option => option.label.toLowerCase().startsWith(typed))
    .map(option => makeCompletion(option, token.range));
}

function findOption(token) {
  if (token.startsWith("-XX:")) {
    const name = token.slice(4).replace(/^[+-]/, "").split("=")[0];
    return optionByXXName.get(name);
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

function activate(context) {
  context.subscriptions.push(
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
}

function deactivate() {}

module.exports = {
  activate,
  deactivate
};
