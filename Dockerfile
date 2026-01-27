FROM node:20-bullseye

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY prisma ./prisma
RUN npx prisma generate

RUN npx playwright install --with-deps chromium

COPY tsconfig.json ./
COPY src ./src

RUN npm run build

ENV NODE_ENV=production

EXPOSE 3000

CMD ["npm", "run", "start"]
