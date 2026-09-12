FROM python:3.12-slim AS wheels
WORKDIR /build
COPY requirements.txt .
RUN pip wheel --only-binary=:all: --wheel-dir=/wheels -r requirements.txt

FROM python:3.12-slim
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright CRAWLER_STATE_DIR=/state PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 POLARS_MAX_THREADS=2
WORKDIR /app
COPY requirements.txt .
COPY --from=wheels /wheels /wheels
RUN pip install --no-cache-dir --no-index --find-links=/wheels -r requirements.txt && rm -rf /wheels && useradd --create-home --uid 10001 radar
RUN python -m playwright install --with-deps chromium && chmod -R a+rX /ms-playwright && mkdir -p /state && chown radar:radar /state
COPY --chown=radar:radar . .
USER radar
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=2)"
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000", "--limit-concurrency", "16", "--timeout-keep-alive", "5"]
