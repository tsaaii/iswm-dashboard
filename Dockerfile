FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY dashboard ./dashboard
# one worker, many threads: each live camera view holds one connection open
CMD exec gunicorn --bind :$PORT --workers 1 --threads 32 --timeout 0 "dashboard.app:create_app()"
