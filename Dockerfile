FROM node:22-alpine

WORKDIR /app

# Install only production deps based on lockfile
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# Copy application code
COPY . .

ENV NODE_ENV=production

EXPOSE 3000
CMD ["npm", "start"]