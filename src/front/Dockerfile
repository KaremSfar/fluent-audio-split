FROM node:24-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

ARG VITE_SERVICE_URL=http://localhost:8080
ARG VITE_OTEL_ENDPOINT=http://localhost:4318
ENV VITE_SERVICE_URL=$VITE_SERVICE_URL
ENV VITE_OTEL_ENDPOINT=$VITE_OTEL_ENDPOINT

RUN npm run build

FROM nginx:alpine AS runtime
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
