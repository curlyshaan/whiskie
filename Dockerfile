FROM node:20-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json /app/
RUN npm ci

COPY . /app

ENV PATH="/app/node_modules/.bin:${PATH}"

CMD ["node", "src/index.js"]
