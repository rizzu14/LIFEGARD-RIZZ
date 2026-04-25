FROM python:3.11-slim AS base

# System dependencies for OpenCV, rasterio, insightface
RUN apt-get update && apt-get install -y --no-install-recommends \
    libglib2.0-0 libsm6 libxext6 libxrender-dev libgomp1 \
    libgdal-dev gdal-bin \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# Download spaCy model
RUN python -m spacy download en_core_web_sm

# Copy source
COPY src/ ./src/

# Create model and data directories
RUN mkdir -p models data logs

# Non-root user
RUN useradd -m -u 1001 lifegrid && chown -R lifegrid:lifegrid /app
USER lifegrid

EXPOSE 5001

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD python -c "import httpx; httpx.get('http://localhost:5001/health').raise_for_status()"

CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "5001", \
     "--workers", "2", "--loop", "uvloop", "--http", "httptools"]
