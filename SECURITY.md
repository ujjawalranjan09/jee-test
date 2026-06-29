# Security Policy

## Supported Versions

We currently support the latest stable release with security updates.

| Version | Supported          |
|---------|-------------------|
| 1.x.x   | :white_check_mark: |

## Reporting a Vulnerability

We take the security of **PDF Quiz Generator** seriously. If you discover a security vulnerability, please follow these steps:

1. **Do NOT open a public issue** — instead, send a private report.
2. Email your findings to **ujjawalranjan09@gmail.com**
3. Include as much detail as possible:
   - Type of vulnerability
   - Steps to reproduce
   - Potential impact
   - Any suggested mitigations

### What to expect

- **Acknowledgment** within 48 hours of your report.
- **Updates** every 5 business days until the issue is resolved.
- **Disclosure** coordination — we'll work with you to determine an appropriate disclosure timeline.

## Security Best Practices

### For Deployment

1. **API Keys**: Never commit API keys to the repository. Use environment variables (via Render dashboard or `.env` files).
2. **CORS**: Restrict `CORS_ORIGINS` to your actual frontend domain in production.
3. **File Uploads**: The application validates PDF size (max 20 MB) and type. Ensure your reverse proxy enforces these limits.
4. **HTTPS**: Always use HTTPS in production (Render enforces this by default).

### For Contributors

- Run `pip-audit` or `npm audit` before submitting changes that introduce new dependencies.
- Avoid storing sensitive data in logs or error messages returned to clients.
- Sanitize any user-supplied data before rendering in the frontend.

## Reporting Non-Security Bugs

For general bugs and feature requests, please open a [GitHub Issue](https://github.com/ujjawalranjan09/jee-test/issues/new/choose).