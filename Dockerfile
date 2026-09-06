# Multi-stage: the build stage needs the full dependency tree (TypeScript,
# @nestjs/cli, ...) to produce dist/; the runtime stage only ever needs
# what dist/main.js actually imports at runtime (@nestjs/*, pg,
# drizzle-orm, @modelcontextprotocol/sdk, ...) - keeping dev-only tooling
# out of the deployed image.
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist

# Schema migrations are a separate, explicit step (see database.module.ts's
# own comment) - `npm run db:migrate` against DATABASE_URL, run once from
# wherever's convenient, not part of this image's own startup. This image
# only ever runs the already-built, already-migrated-against server.
EXPOSE 3000
CMD ["node", "dist/main.js"]
