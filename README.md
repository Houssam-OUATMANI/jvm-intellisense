# JVM IntelliSense

Language support for JVM launch options and Java argument files in Visual Studio Code.

## Current features

- Associates `jvm.args` with the `jvm-args` language.
- Highlights JVM options, system properties, values, comments, quoted arguments, and `@file` references.
- Uses standard TextMate scopes so colors come from the active VS Code theme.
- Configures `#` line comments and quote pairing.
- Provides initial completion and hover documentation for common JVM and Java launcher options.
- Suggests example values for common heap, stack, and selected `-XX` options.
- Reports malformed arguments and invalid values, plus repeated options and conflicting garbage collectors.
- Marks options absent from the bundled catalog as informational because their availability depends on the JDK.
- Detects Java from `JAVA_HOME` or `PATH`, or lets you select a Java executable/JDK home.
- Loads `-XX` flags from the selected JVM with `-XX:+PrintFlagsFinal` and adapts flag completions and diagnostics.
- Provides a command to validate JVM options with the selected Java executable.

## Custom file associations

Associate other file names or extensions with the language using VS Code settings:

```json
{
  "files.associations": {
    "*.vmoptions": "jvm-args",
    "custom-launch-options.txt": "jvm-args"
  }
}
```

The option catalog is an initial, curated baseline rather than a complete list. Option availability and defaults vary by JDK version and vendor; when a JDK is selected, `-XX` flags are read from that JVM and options it does not report remain informational.

## JDK integration

The extension detects Java from `JAVA_HOME` and then `PATH`. To choose another installation, run **JVM IntelliSense: Select JDK** or set `jvmIntelliSense.javaPath` to a Java executable or JDK home directory.

Run **JVM IntelliSense: Validate Options with Java** from a JVM argument file to check its JVM options with the selected executable. The command asks for confirmation because Java agent options may execute code. It does not expand `@file` references or launch an application.
