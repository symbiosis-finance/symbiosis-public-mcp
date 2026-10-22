FROM node:22.23.4-alpine3.24 AS builder
RUN apk add --no-cache 'ca-certificates>=20261020-r0'
WORKDIR /app
COPY package*.json ./
RUN npm ci --production=false
COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
COPY SKILL.md ./
RUN npm run build

FROM node:22.23.4-alpine3.24
RUN apk add --no-cache 'ca-certificates>=20261020-r0'
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY package*.json ./
COPY SKILL.md ./
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "dist/index.js"]
