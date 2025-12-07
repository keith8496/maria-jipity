FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --production

COPY . .

# Expect OPENAI_API_KEY at runtime
EXPOSE 3000

CMD ["npm", "start"]