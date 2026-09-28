# frontend/Dockerfile
#
# Two stages: build the static Vite bundle, then serve it with the tiny
# `serve` static file server. Vite inlines VITE_* env vars at build time
# (not runtime), so VITE_API_BASE_URL has to be passed as a build ARG —
# docker-compose.yml wires this up automatically.

# ---- Build stage ----------------------------------------------------------
FROM node:20-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

ARG VITE_API_BASE_URL=http://localhost:8000
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}

RUN npm run build

# ---- Serve stage ------------------------------------------------------------
FROM node:20-alpine AS serve

WORKDIR /app
RUN npm install -g serve@14

COPY --from=build /app/dist ./dist

# Match Vite's own dev-server port so no extra CORS origin needs to be
# configured on the backend (see backend/main.py's FRONTEND_ORIGINS default).
EXPOSE 5173

CMD ["serve", "-s", "dist", "-l", "5173"]
