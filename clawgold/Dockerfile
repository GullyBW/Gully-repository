# ClawGold container image.
#
# This image runs the paper broker, the research worker, the dashboard and
# the full CLI. It CANNOT trade live: the MetaTrader5 package is
# Windows-only and is deliberately excluded — see docs/DEPLOYMENT.md for
# the live path.

FROM python:3.12-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PYTHONPATH=/app/scripts

WORKDIR /app

# Build tooling lives in its own layer and is removed after the wheels are
# built, so it does not ship in the runtime image.
RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential libgomp1 \
    && rm -rf /var/lib/apt/lists/*

# Dependencies first: this layer is cached unless the requirements change,
# so ordinary code edits do not trigger a full reinstall.
COPY requirements-dev.txt ./requirements-dev.txt
RUN pip install --upgrade pip \
    && pip install -r requirements-dev.txt \
    && pip install streamlit \
    && apt-get purge -y --auto-remove build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY . .

# Run as an unprivileged user. A trading process has no reason to be root,
# and a container escape from root is a far worse day than one from uid 1000.
RUN useradd --create-home --uid 1000 clawgold \
    && mkdir -p /app/data /app/logs \
    && chown -R clawgold:clawgold /app \
    && chmod +x docker/entrypoint.sh

USER clawgold

# Data and logs are volumes: SQLite state and the trade journal must
# survive a container replacement.
VOLUME ["/app/data", "/app/logs"]

# The healthcheck reads the worker's heartbeat file. A process that is
# running but wedged fails this, which a bare process check would not catch.
HEALTHCHECK --interval=60s --timeout=10s --start-period=90s --retries=3 \
    CMD python docker/healthcheck.py || exit 1

ENTRYPOINT ["docker/entrypoint.sh"]

# Default to the research worker: it is the useful long-running job that
# needs no broker account. The previous default was `claw.py news stats`,
# a one-shot that exited immediately and left the container restarting.
CMD ["python", "scripts/news_worker.py"]
