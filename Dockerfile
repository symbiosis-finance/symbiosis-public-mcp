FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --production=false
COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
COPY SKILL.md ./
RUN npm run build

FROM node:22-alpine
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY package*.json ./
COPY SKILL.md ./
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "dist/index.js"]
