# Build stage
FROM node:20-slim AS build
WORKDIR /build

# Copy the entire monorepo
COPY --from=breadboard / ./

# Install ALL dependencies, including devDependencies
RUN npm ci

# Build the project
WORKDIR /build/packages/board-server
RUN npm run build

# Production stage
FROM node:20-slim

ARG STORAGE_BACKEND="sqlite"
ARG ALLOWED_ORIGINS=""
ARG SQLITE_DB_PATH="board-server.db"

ENV NODE_ENV=production
ENV STORAGE_BACKEND="${STORAGE_BACKEND}"
ENV ALLOWED_ORIGINS="${ALLOWED_ORIGINS}"
ENV SQLITE_DB_PATH="${SQLITE_DB_PATH}"

WORKDIR /app

# Copy necessary files from the build stage
COPY --from=build /build/packages/board-server/dist ./dist
COPY --from=build /build/packages/board-server/src ./src
COPY --from=build /build/packages/board-server/package.json ./
COPY --from=build /build/packages/board-server/public ./public
COPY --from=build /build/packages/board-server/scripts ./scripts

# Install necessary tools, Java, and Flyway CLI, then copy migration scripts if STORAGE_BACKEND is sqlite
RUN apt-get update && apt-get install -y wget tar default-jre && \
    if [ "$STORAGE_BACKEND" = "sqlite" ]; then \
    wget -qO- https://repo1.maven.org/maven2/org/flywaydb/flyway-commandline/9.8.1/flyway-commandline-9.8.1-linux-x64.tar.gz | tar xvz && \
    ln -s /app/flyway-9.8.1/flyway /usr/local/bin && \
    mkdir -p /flyway/sql && \
    cp -r /app/src/migrations/* /flyway/sql/; \
    fi && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# Install production dependencies and tsx
RUN npm install --only=production && \
    npm install -g tsx

EXPOSE 3000

# Run Flyway migrate before starting the application if STORAGE_BACKEND is sqlite
CMD if [ "$STORAGE_BACKEND" = "sqlite" ]; then \
    flyway -url="jdbc:sqlite:${SQLITE_DB_PATH}" -locations=filesystem:/flyway/sql migrate; \
    fi && \
    node dist/server/index.js --host=0.0.0.0