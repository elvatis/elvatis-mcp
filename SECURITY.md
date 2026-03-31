# Security Policy

## Reporting a Vulnerability

If you believe you have found a security vulnerability in this project, please report it responsibly:

1. **Do not open a public issue.** Instead, send an email to **security@elvatis.com** with:
   - A clear description of the vulnerability
   - Steps to reproduce
   - Expected and actual behavior
   - Any PoC code or attachments (zip) if safe to share

2. We will acknowledge receipt within **48 hours** and provide a timeline for fixes.

3. Do not publicly disclose the issue until we have had a reasonable time to address it.

## Scope

This project connects to remote systems via SSH and to Home Assistant via HTTP.
Security-relevant areas include:

- SSH key handling and connection parameters
- Environment variable management (tokens, credentials)
- Input validation on tool arguments (shell injection in SSH commands)
- MCP protocol transport (stdio and HTTP modes)

We appreciate responsible disclosure.
