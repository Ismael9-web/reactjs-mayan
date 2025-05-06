# Multi-stage build process for React + Node.js application

# Stage 1: Build stage - Compiles the frontend and installs dependencies
FROM node:18-alpine as build

# Set working directory for all operations
WORKDIR /app

# Copy package.json files first to leverage Docker layer caching
# This allows us to cache npm install if dependencies haven't changed
COPY package*.json ./
COPY backend/package*.json ./backend/

# Install frontend dependencies
RUN npm install

# Copy all source files and build the frontend
COPY . .
RUN npm run build

# Install backend dependencies
WORKDIR /app/backend
RUN npm install

# Stage 2: Production stage - Creates the final, optimized image
FROM node:18-alpine as production
WORKDIR /app

# Copy only the necessary files from build stage
# This reduces the final image size by excluding development dependencies
COPY --from=build /app/dist ./dist
COPY --from=build /app/backend ./backend

# Expose ports for frontend and backend services
EXPOSE 3000 5000

# Start the backend server which serves both the API and frontend
CMD ["node", "backend/server.js"]