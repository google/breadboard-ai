FROM node:lts

COPY . .

RUN npm install --save-dev
RUN npm run build

ENV NODE_ENV="production"
EXPOSE 3000

CMD ["node", "dist/src/server/main.js"]
