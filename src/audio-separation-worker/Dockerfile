FROM python:3.12-slim AS base

WORKDIR /worker

# Install build deps needed for some kombu/amqp C extensions
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    libc6-dev \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .

# Install PyTorch CPU-only explicitly first from the official index.
# This avoids pip trying to resolve & download the full GPU wheel (~2GB)
# through the default PyPI CDN which is prone to timeout in CI/Docker builds.
RUN pip install --no-cache-dir --timeout 300 --retries 5 \
    torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cpu

# Install the rest of the dependencies
RUN pip install --no-cache-dir --timeout 300 --retries 5 -r requirements.txt

COPY . .

CMD ["python", "run_consumer.py"]
