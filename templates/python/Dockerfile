FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt* pyproject.toml* ./
RUN pip install --no-cache-dir -r requirements.txt || true
COPY . .
RUN useradd -m appuser
USER appuser
ENV PORT=8080
EXPOSE 8080
CMD ["python","main.py"]
