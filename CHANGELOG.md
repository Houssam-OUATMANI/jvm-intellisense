# Changelog

All notable changes to this project are documented in this file.

## [0.1.0] - 2026-10-28

### Added

- `jvm-args` language support for `jvm.args`, `.jvmargs`, and `.vmoptions` files.
- Theme-aware syntax highlighting for JVM options, values, comments, strings, and `@file` references.
- Initial option completion, contextual value suggestions, and hover documentation.
- Diagnostics for malformed arguments, invalid values, duplicate options, and known garbage collector conflicts.
- JDK auto-detection and selection, dynamic `-XX` flags from `-XX:+PrintFlagsFinal`, and an explicit Java validation command.
- Automated tests for diagnostics, argument parsing, flag parsing, and extension metadata.
