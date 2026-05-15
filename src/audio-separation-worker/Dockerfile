FROM python:3.12-slim AS base

WORKDIR /worker

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

CMD ["celery", "-A", "app.celery:celery_app", "worker", "--loglevel=info", "--concurrency=1"]
