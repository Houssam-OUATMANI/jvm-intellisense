# Changelog

All notable changes to this project are documented in this file.

## [Unreleased]

### Added

- Configurable JVM argument file extensions with `.args`, `.jvmargs`, and `.vmoptions` as defaults.
- Marketplace icon and searchable JVM/Java extension keywords.
- Configuration examples explaining how to avoid conflicts with generic extensions.
- English warnings and errors for known deprecated/removed flags, including CMS removal in Java 14.
- A warning explaining that nested Java argument-file references are not expanded by the launcher.

### Changed

- Argument file extensions are no longer globally claimed by the language contribution; only configured Plain Text files are automatically switched to `jvm-args`.
- Open documents are immediately switched into or out of JVM argument support when the extension list changes.

## [0.1.0] - 2026-10-28

### Added

- `jvm-args` language support for `jvm.args`, `.jvmargs`, and `.vmoptions` files.
- Theme-aware syntax highlighting for JVM options, values, comments, strings, and `@file` references.
- Navigation to referenced argument files and automatic IntelliSense for referenced extensionless files.
- Initial option completion, contextual value suggestions, and hover documentation.
- Diagnostics for malformed arguments, invalid values, duplicate options, and known garbage collector conflicts.
- JDK auto-detection and selection, dynamic `-XX` flags from `-XX:+PrintFlagsFinal`, and an explicit Java validation command.
- Automated tests for diagnostics, argument parsing, flag parsing, and extension metadata.
