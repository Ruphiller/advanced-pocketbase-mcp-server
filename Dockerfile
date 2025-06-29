# Smithery-compatible Dockerfile
FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies with fallback for missing package-lock.json
RUN npm install

# Copy application code
COPY . .

# Build the application
RUN npm run build

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S mcp -u 1001

# Change ownership of the app directory
RUN chown -R mcp:nodejs /app
USER mcp

# Expose the port on which the server will run (will be set by PORT environment variable)
EXPOSE 3000

# Health check for container monitoring
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "const http = require('http'); const options = { hostname: 'localhost', port: process.env.PORT || 3000, path: '/health', timeout: 2000 }; const req = http.request(options, (res) => { if (res.statusCode === 200) { process.exit(0); } else { process.exit(1); } }); req.on('error', () => process.exit(1)); req.on('timeout', () => process.exit(1)); req.end();"

# Set default environment variables (these will be overridden by Smithery)
ENV POCKETBASE_URL=http://127.0.0.1:8090
ENV POCKETBASE_ADMIN_EMAIL=""
ENV POCKETBASE_ADMIN_PASSWORD=""
ENV POCKETBASE_DATA_DIR=""
ENV STRIPE_SECRET_KEY=""
ENV STRIPE_WEBHOOK_SECRET=""
ENV EMAIL_SERVICE=""
ENV SENDGRID_API_KEY=""
ENV SMTP_HOST=""
ENV SMTP_PORT="587"
ENV SMTP_USER=""
ENV SMTP_PASS=""
ENV DEFAULT_FROM_EMAIL=""
ENV APP_NAME=""
ENV APP_URL=""

# Start the server with SSE transport for Smithery compatibility
# Smithery will pass configuration via query parameters to /mcp endpoint
CMD ["node", "build/index.js", "--transport=sse", "--port=${PORT:-3000}", "--host=0.0.0.0"]
