# Elastic Search Local Setup

This guide explains how to run Elastic Search locally using Docker/Podman for development purposes.

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) or [Podman](https://podman.io/getting-started/installation)

## Quick Start

Follow the official Elastic Search local development quickstart:

**[Elastic Search Local Development Installation Quickstart](https://www.elastic.co/docs/deploy-manage/deploy/self-managed/local-development-installation-quickstart)**

## Known Issues

### Certificate Issues (Netskope)

If you encounter TLS/SSL certificate errors when pulling images or connecting to Elastic Search, this is likely caused by **Netskope** SSL inspection intercepting traffic on the corporate network.

#### Symptoms

- `x509: certificate signed by unknown authority` when pulling Docker images
- SSL handshake failures from containers
- `CERTIFICATE_VERIFY_FAILED` errors


The Netskope certificate must be added to Docker's trusted certificates. The approach varies by OS.

### Variable Interpolation in `.env`

The `elastic-start-local` tool may generate `.env` values that reference other variables, e.g.:

```
ES_LOCAL_PORT=9200
ES_LOCAL_URL=http://localhost:${ES_LOCAL_PORT}
```

VS Code's `envFile` loader (used in `launch.json`) does **not** resolve `${VAR}` references — it passes the literal string `http://localhost:${ES_LOCAL_PORT}` to the extension. If you see connection errors pointing to a URL containing `${...}`, replace the variable reference with the actual value in `elastic-start-local/.env`:

```
ES_LOCAL_URL=http://localhost:9200
```
