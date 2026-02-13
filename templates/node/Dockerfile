FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev || npm install --omit=dev
COPY . .
RUN addgroup -S app && adduser -S app -G app
USER app
ENV PORT=8080
EXPOSE 8080
CMD ["npm","start"]
