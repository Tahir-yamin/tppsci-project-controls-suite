# syntax=docker/dockerfile:1

# ---- Build ----------------------------------------------------------------
FROM node:22-alpine AS build

WORKDIR /app

# Copy manifests first so dependency layers survive source-only changes.
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json vite.config.ts index.html ./
COPY src ./src
COPY public ./public

# Type errors fail the image rather than shipping a broken bundle.
RUN npm run build

# ---- Serve ----------------------------------------------------------------
FROM nginx:1.27-alpine AS runtime

# RunPod routes HTTP pods through a proxy on this port.
ENV PORT=8080

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/templates/default.conf.template

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/" >/dev/null 2>&1 || exit 1

# The stock nginx entrypoint expands ${PORT} in the template above.
CMD ["nginx", "-g", "daemon off;"]
