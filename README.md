# JVM IntelliSense

Language support for JVM launch options and Java argument files in Visual Studio Code.

## Requirements

- Visual Studio Code 1.80 or later.
- Node.js 18 or later to run the test suite.
- A JDK is optional for editing and static diagnostics; JDK-aware completions and real JVM validation require a selected Java executable.

## Current features

- Associates `jvm.args` and configurable argument-file extensions with the `jvm-args` language.
- Highlights JVM options, system properties, values, comments, quoted arguments, and `@file` references.
- Uses standard TextMate scopes so colors come from the active VS Code theme.
- Opens `@file` references with one native document link spanning the entire reference (Ctrl+Click), resolves paths relative to the containing argument file, and enables IntelliSense for referenced files.
- Configures `#` line comments and quote pairing.
- Provides initial completion and hover documentation for common JVM and Java launcher options.
- Suggests example values for common heap, stack, and selected `-XX` options.
- Reports malformed arguments and invalid values, plus repeated options and conflicting garbage collectors.
- Marks options absent from the bundled catalog as informational because their availability depends on the JDK.
- Detects Java from `JAVA_HOME` or `PATH`, or lets you select a Java executable/JDK home.
- Loads `-XX` flags from the selected JVM with `-XX:+PrintFlagsFinal` and adapts flag completions and diagnostics.
- Provides a command to validate JVM options with the selected Java executable.

## Custom file associations

By default, `.args`, `.jvmargs`, and `.vmoptions` files are treated as JVM argument files when VS Code otherwise identifies them as Plain Text. Since extensions such as `.args` are generic and may conflict with other tools, replace the defaults with the extensions you use in VS Code settings:

```json
{
  "jvmIntelliSense.fileExtensions": [
    ".jvmopts",
    ".launchargs"
  ]
}
```

Entries must include the leading dot. The setting replaces the default list, so add any defaults you still want to keep. For example, set it to `[".jvmopts"]` to stop automatically claiming `.args` files. Close and reopen files after changing this setting. Other language associations are left untouched.

Alternatively, explicitly associate a filename or glob through VS Code's built-in `files.associations` setting:

```json
{
  "files.associations": {
    "*.launchargs": "jvm-args",
    "custom-launch-options.txt": "jvm-args"
  }
}
```

Files referenced from a `jvm-args` file are also opened with the JVM argument language when their current language is Plain Text, so completion and diagnostics work for extensionless files such as `@jvm-blaa`.

If another extension already claims an extension, its language association takes precedence. You can explicitly use `files.associations` to assign a chosen pattern to `jvm-args`.

The option catalog is an initial, curated baseline rather than a complete list. Option availability and defaults vary by JDK version and vendor; when a JDK is selected, `-XX` flags are read from that JVM and options it does not report remain informational.

## JDK integration

The extension detects Java from `JAVA_HOME` and then `PATH`. To choose another installation, run **JVM IntelliSense: Select JDK** or set `jvmIntelliSense.javaPath` to a Java executable or JDK home directory.

Run **JVM IntelliSense: Validate Options with Java** from a JVM argument file to check its JVM options with the selected executable. The command asks for confirmation because Java agent options may execute code. It does not expand `@file` references or launch an application.

## Development

Run the automated tests with:

```sh
npm test
```

The test suite uses Node.js built-ins and does not require installing project dependencies.

## License

This project is distributed under the [MIT License](./LICENSE).
