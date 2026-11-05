# Security Policy

## Supported versions

Security fixes are provided for the latest published release.

## Development trust boundary

Run NativeMason against projects you trust. The local MCP client can request source edits, and the app executes its own development code; this tool is not a sandbox for untrusted projects. Native measurements use a developer-configured endpoint and pairing token, with loopback as the default and private LAN binding as an explicit option. Keep that development endpoint on a trusted network and close sessions when finished.

## Reporting a vulnerability

Please report suspected vulnerabilities through GitHub's private vulnerability reporting for this repository. Do not open a public issue for an unpatched vulnerability. The maintainers will acknowledge reports and coordinate a fix and disclosure timeline privately.
