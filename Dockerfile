FROM node:20-alpine

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm ci --only=production

COPY src/ ./src/
COPY public/ ./public/

EXPOSE 3000
ENV PORT=3000

CMD ["node", "src/server.js"]
