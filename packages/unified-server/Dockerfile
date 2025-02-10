FROM node:lts
WORKDIR /breadboard

# This file uses a named context that points to the root of the monorepo.
# https://docs.docker.com/build/concepts/context/#named-contexts
#
# It must be supplied using the --build-context flag when building the image:
# build-context=breadboard=../.. .
COPY --from=breadboard / .

RUN npm install --save-dev

WORKDIR packages/unified-server
RUN npm run build

ENV NODE_ENV="production"
EXPOSE 3000

CMD ["node", "dist/src/server/main.js"]
