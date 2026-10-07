FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG VITE_API_BASE_URL=/api
ARG VITE_AGUI_URL=/agent
ARG VITE_AGUI_ENABLED=true
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL VITE_AGUI_URL=$VITE_AGUI_URL VITE_AGUI_ENABLED=$VITE_AGUI_ENABLED
RUN npm run build-only

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
