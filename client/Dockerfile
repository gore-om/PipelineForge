FROM node:24-alpine AS build
WORKDIR /app

COPY package*.json ./
COPY client/package.json ./client/package.json
RUN npm ci --workspace client

COPY client ./client
RUN npm run build --workspace client

FROM nginx:1.27-alpine
COPY client/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/client/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
