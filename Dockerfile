FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    DATA_DIR=/app/data \
    OUTPUT_DIR=/app/output \
    PORT=7401

ARG APP_VERSION=dev
LABEL org.opencontainers.image.version="${APP_VERSION}"

WORKDIR /app

COPY requirements.txt .
# 国内 NAS 构建慢时，可传 --build-arg PIP_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple
ARG PIP_INDEX_URL=https://pypi.org/simple
RUN pip install --no-cache-dir --index-url ${PIP_INDEX_URL} -r requirements.txt

COPY app ./app
RUN mkdir -p /app/data/images /app/output

# data/ = 数据库 + 网页展示图片；output/ = 按用户分目录的成品存档（两个独立目录）
VOLUME ["/app/data", "/app/output"]
EXPOSE 7401

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:7401/api/health', timeout=3)" || exit 1

CMD ["python", "-m", "app"]
