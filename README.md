# JVM IntelliSense

Language support for JVM launch options and Java argument files in Visual Studio Code.

## Current features

- Associates `jvm.args` with the `jvm-args` language.
- Highlights JVM options, system properties, values, comments, quoted arguments, and `@file` references.
- Uses standard TextMate scopes so colors come from the active VS Code theme.
- Configures `#` line comments and quote pairing.

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

The extension currently provides language identification and syntax highlighting; IntelliSense, diagnostics, and JDK integration are planned for later phases.
