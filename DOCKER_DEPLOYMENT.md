# Docker Deployment Guide

This guide covers how to deploy the Guest Photo Upload backend using Docker and Docker Compose.

## 🐳 Quick Start

### Development Setup

1. **Copy environment file:**
   ```bash
   cp .env.docker .env
   # Edit .env with your configuration
   ```

2. **Start services:**
   ```bash
   npm run docker:dev
   ```

3. **View logs:**
   ```bash
   npm run docker:dev:logs
   ```

4. **Stop services:**
   ```bash
   npm run docker:dev:down
   ```

### Production Setup

1. **Prepare environment:**
   ```bash
   cp .env.docker .env.prod
   # Edit .env.prod with production values
   ```

2. **Deploy:**
   ```bash
   npm run docker:prod
   ```

## 📋 Prerequisites

- Docker Engine 20.10+
- Docker Compose 2.0+
- 2GB+ available RAM
- 10GB+ available disk space

## 🏗️ Architecture

### Development Stack
- **App Container**: Node.js application
- **Redis Container**: Session storage and caching
- **Volumes**: Persistent uploads and data

### Production Stack
- **App Container**: Node.js application (production mode)
- **Redis Container**: Session storage with authentication
- **Nginx Container**: Reverse proxy with SSL termination
- **Volumes**: Persistent storage with host mounts

## ⚙️ Configuration

### Environment Variables

#### Required Variables
```bash
# Application
NODE_ENV=production
SESSION_SECRET=your-very-secure-session-secret
TOKEN_SECRET=your-secure-token-secret

# Google Cloud (choose one method)
GOOGLE_CLOUD_PROJECT_ID=your-project-id
GCP_BUCKET_NAME=your-bucket-name

# Method 1: Service Account Key (mount as volume)
GOOGLE_APPLICATION_CREDENTIALS=/app/credentials/service-account.json

# Method 2: Workload Identity (GKE/Cloud Run)
# Uses metadata service automatically
```

#### Optional Variables
```bash
# Redis
REDIS_PASSWORD=your-redis-password

# OAuth
GOOGLE_OAUTH_CLIENT_ID=your-client-id
GOOGLE_OAUTH_CLIENT_SECRET=your-client-secret

# Stripe
STRIPE_SECRET_KEY=sk_live_your-key
STRIPE_WEBHOOK_SECRET=whsec_your-secret

# Admin
ADMIN_EMAIL=admin@yourdomain.com
```

### SSL Configuration (Production)

1. **Create SSL directory:**
   ```bash
   mkdir -p ssl
   ```

2. **Add certificates:**
   ```bash
   # Add your SSL certificate files
   cp your-cert.pem ssl/cert.pem
   cp your-private-key.pem ssl/private.key
   ```

3. **Or generate self-signed (development only):**
   ```bash
   openssl req -x509 -nodes -days 365 -newkey rsa:2048 \\
     -keyout ssl/private.key -out ssl/cert.pem
   ```

### Google Cloud Credentials

#### Method 1: Service Account Key File
```bash
# Create credentials directory
mkdir -p credentials

# Copy your service account key
cp path/to/your-service-account-key.json credentials/service-account.json

# Ensure proper permissions
chmod 600 credentials/service-account.json
```

#### Method 2: Workload Identity (Recommended for GKE)
```yaml
# In production, use workload identity
apiVersion: v1
kind: ServiceAccount
metadata:
  annotations:
    iam.gke.io/gcp-service-account: your-gsa@your-project.iam.gserviceaccount.com
  name: guestphotoupload
  namespace: default
```

## 🚀 Deployment Commands

### Local Development
```bash
# Build and start development environment
docker-compose up -d

# View real-time logs
docker-compose logs -f app

# Restart specific service
docker-compose restart app

# Execute commands in container
docker-compose exec app sh
```

### Production Deployment
```bash
# Start production stack
docker-compose -f docker-compose.prod.yml up -d

# Check service health
docker-compose -f docker-compose.prod.yml ps

# Update application (zero-downtime)
docker-compose -f docker-compose.prod.yml up -d --no-deps app

# View logs
docker-compose -f docker-compose.prod.yml logs -f
```

### Single Container
```bash
# Build image
npm run docker:build

# Run with environment file
npm run docker:run

# Or run manually
docker run -d \\
  --name guestphotoupload-backend \\
  -p 3000:3000 \\
  --env-file .env \\
  -v $(pwd)/uploads:/app/uploads \\
  guestphotoupload-backend
```

## 📊 Monitoring & Maintenance

### Health Checks

The application includes built-in health checks:
- **HTTP Endpoint**: `GET /api/health`
- **Docker Health Check**: Automatic container health monitoring
- **Startup Probe**: Ensures application is ready before traffic

### Log Management

```bash
# View application logs
docker-compose logs -f app

# View all service logs
docker-compose logs -f

# Limit log output
docker-compose logs --tail=100 app

# Export logs
docker-compose logs --no-color app > app.log
```

### Resource Monitoring

```bash
# Monitor resource usage
docker stats

# View container details
docker inspect guestphotoupload-backend

# Check disk usage
docker system df
```

### Backup & Restore

#### Backup Data
```bash
# Backup uploads volume
docker run --rm -v guestphotoupload-backend_uploads-data:/data \\
  -v $(pwd):/backup alpine tar czf /backup/uploads-backup.tar.gz -C /data .

# Backup Redis data
docker run --rm -v guestphotoupload-backend_redis-data:/data \\
  -v $(pwd):/backup alpine tar czf /backup/redis-backup.tar.gz -C /data .

# Backup SQLite database (if using SQLite)
docker-compose exec app cp /app/app.db /app/uploads/app-backup.db
```

#### Restore Data
```bash
# Restore uploads
docker run --rm -v guestphotoupload-backend_uploads-data:/data \\
  -v $(pwd):/backup alpine tar xzf /backup/uploads-backup.tar.gz -C /data

# Restore Redis data
docker run --rm -v guestphotoupload-backend_redis-data:/data \\
  -v $(pwd):/backup alpine tar xzf /backup/redis-backup.tar.gz -C /data
```

## 🔧 Troubleshooting

### Common Issues

#### Container Won't Start
```bash
# Check container logs
docker-compose logs app

# Check container status
docker-compose ps

# Validate compose file
docker-compose config
```

#### Permission Issues
```bash
# Fix volume permissions
sudo chown -R 1001:1001 uploads/

# Check container user
docker-compose exec app id
```

#### Memory Issues
```bash
# Monitor memory usage
docker stats --no-stream

# Increase memory limits in docker-compose.yml
services:
  app:
    deploy:
      resources:
        limits:
          memory: 2G
```

#### Network Issues
```bash
# Test connectivity between containers
docker-compose exec app ping redis

# Check network configuration
docker network ls
docker network inspect guestphotoupload-backend_app-network
```

### Debug Mode

Enable debug logging:
```bash
# Add to .env
DEBUG=*

# Or specific modules
DEBUG=express:*,redis:*,qr:*
```

## 🔄 Updates & Maintenance

### Application Updates
```bash
# Pull latest changes
git pull origin master

# Rebuild and restart
docker-compose build --no-cache
docker-compose up -d
```

### Security Updates
```bash
# Update base images
docker-compose pull
docker-compose up -d

# Scan for vulnerabilities
docker scout quickview guestphotoupload-backend
```

### Scaling

#### Horizontal Scaling
```yaml
# docker-compose.prod.yml
services:
  app:
    deploy:
      replicas: 3
    ports: []  # Remove direct port mapping
```

#### Load Balancing
```bash
# Use external load balancer or update nginx configuration
# for multiple backend instances
```

## 📈 Performance Optimization

### Production Optimizations

1. **Multi-stage build** (already implemented)
2. **Non-root user** (already implemented)
3. **Health checks** (already implemented)
4. **Log rotation** (configured in production compose)
5. **Resource limits**:
   ```yaml
   deploy:
     resources:
       limits:
         cpus: '2'
         memory: 2G
       reservations:
         cpus: '0.5'
         memory: 512M
   ```

### Redis Optimization
```bash
# Production Redis configuration
redis-server --maxmemory 1gb --maxmemory-policy allkeys-lru
```

## 🌐 Cloud Deployment

### Google Cloud Run
```bash
# Build for Cloud Run
gcloud builds submit --tag gcr.io/your-project/guestphotoupload

# Deploy
gcloud run deploy guestphotoupload \\
  --image gcr.io/your-project/guestphotoupload \\
  --platform managed \\
  --region us-central1 \\
  --allow-unauthenticated
```

### AWS ECS/Fargate
```bash
# Build and push to ECR
aws ecr get-login-password --region us-east-1 | \\
  docker login --username AWS --password-stdin your-account.dkr.ecr.us-east-1.amazonaws.com

docker build -t your-account.dkr.ecr.us-east-1.amazonaws.com/guestphotoupload .
docker push your-account.dkr.ecr.us-east-1.amazonaws.com/guestphotoupload
```

### Kubernetes
```yaml
# deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: guestphotoupload
spec:
  replicas: 3
  selector:
    matchLabels:
      app: guestphotoupload
  template:
    metadata:
      labels:
        app: guestphotoupload
    spec:
      serviceAccountName: guestphotoupload
      containers:
      - name: app
        image: guestphotoupload-backend:latest
        ports:
        - containerPort: 3000
        env:
        - name: NODE_ENV
          value: "production"
        - name: REDIS_HOST
          value: "redis-service"
```

This Docker setup provides a complete containerization solution with development and production configurations, SSL support, monitoring, and deployment options for various cloud platforms.