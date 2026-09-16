FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json server.mjs model.mjs ./
COPY public ./public
ENV NODE_ENV=production
ENV DATA_DIR=/data
EXPOSE 8080
CMD ["node", "server.mjs"]
