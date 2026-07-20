FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --chown=node:node src ./src
ENV NODE_ENV=production
ENV PORT=8080
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/health/live').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["npm", "start"]
