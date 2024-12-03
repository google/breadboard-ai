# Use a base image that supports multiple platforms for the build stage
FROM --platform=$BUILDPLATFORM node:20 AS build

WORKDIR /build

# Copy the entire monorepo
COPY --from=breadboard / ./

# Install ALL dependencies, including devDependencies
RUN npm ci

# Build the project
WORKDIR /build/packages/board-server
RUN npm run build

# Use a lightweight base image for the runtime stage
FROM --platform=$TARGETPLATFORM node:20

ARG STORAGE_BACKEND
ARG ALLOWED_ORIGINS=""

ENV NODE_ENV=production
ENV STORAGE_BACKEND="${STORAGE_BACKEND}"
ENV ALLOWED_ORIGINS="${ALLOWED_ORIGINS}"

WORKDIR /app

# Copy necessary files from the build stage
COPY --from=build /build/packages/board-server/dist ./dist
COPY --from=build /build/packages/board-server/src ./src
COPY --from=build /build/packages/board-server/package.json ./
COPY --from=build /build/packages/board-server/public ./public
COPY --from=build /build/packages/board-server/scripts ./scripts

# Install production dependencies and tsx
RUN npm install --only=production && \
    npm install -g tsx

EXPOSE 3000
CMD ["node", "dist/server/index.js", "--host=0.0.0.0"]
