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

The option catalog is an initial, curated baseline rather than a complete list. Option availability and defaults vary by JDK version and vendor; the extension therefore reports uncatalogued options as informational rather than treating them as invalid.
