# Fly.io / Docker 用
FROM node:22-slim

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY src ./src
COPY scripts ./scripts

# Fly が PORT を注入。未設定時は 8080
ENV PORT=8080
EXPOSE 8080

CMD ["npm", "start"]
