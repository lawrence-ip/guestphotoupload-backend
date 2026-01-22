#!/bin/bash

# Guest Photo Upload Backend - Docker Setup Script

set -e

echo "🐳 Guest Photo Upload Backend - Docker Setup"
echo "============================================"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if Docker is installed
check_docker() {
    print_status "Checking Docker installation..."
    if ! command -v docker &> /dev/null; then
        print_error "Docker is not installed. Please install Docker first."
        exit 1
    fi
    print_success "Docker is installed"
}

# Check if Docker Compose is installed
check_docker_compose() {
    print_status "Checking Docker Compose installation..."
    if ! command -v docker-compose &> /dev/null; then
        print_error "Docker Compose is not installed. Please install Docker Compose first."
        exit 1
    fi
    print_success "Docker Compose is installed"
}

# Setup environment file
setup_env() {
    print_status "Setting up environment file..."
    if [ ! -f .env ]; then
        if [ -f .env.docker ]; then
            cp .env.docker .env
            print_success "Created .env from .env.docker template"
            print_warning "Please edit .env file with your configuration before continuing"
        else
            print_error ".env.docker template not found"
            exit 1
        fi
    else
        print_warning ".env file already exists. Skipping creation."
    fi
}

# Create necessary directories
create_directories() {
    print_status "Creating necessary directories..."
    
    mkdir -p uploads
    mkdir -p credentials
    mkdir -p ssl
    
    # Create uploads .gitkeep if it doesn't exist
    if [ ! -f uploads/.gitkeep ]; then
        touch uploads/.gitkeep
    fi
    
    print_success "Directories created successfully"
}

# Build Docker images
build_images() {
    print_status "Building Docker images..."
    docker-compose build
    print_success "Docker images built successfully"
}

# Start services
start_services() {
    print_status "Starting Docker services..."
    docker-compose up -d
    print_success "Services started successfully"
}

# Check service health
check_health() {
    print_status "Checking service health..."
    
    # Wait for services to start
    sleep 10
    
    # Check if containers are running
    if docker-compose ps | grep -q "Up"; then
        print_success "Services are running"
        
        # Check API health endpoint
        print_status "Checking API health endpoint..."
        for i in {1..30}; do
            if curl -f http://localhost:3000/api/health > /dev/null 2>&1; then
                print_success "API is healthy and responding"
                return 0
            fi
            sleep 2
        done
        print_warning "API health check timeout. Service might still be starting."
    else
        print_error "Some services failed to start"
        docker-compose logs
        exit 1
    fi
}

# Show service status
show_status() {
    echo ""
    echo "🎉 Setup completed successfully!"
    echo ""
    echo "Services:"
    docker-compose ps
    echo ""
    echo "📋 Available commands:"
    echo "  npm run docker:dev        # Start development services"
    echo "  npm run docker:dev:logs   # View logs"
    echo "  npm run docker:dev:down   # Stop services"
    echo "  npm run docker:prod       # Start production services"
    echo ""
    echo "🌐 Application URL: http://localhost:3000"
    echo "🩺 Health check: http://localhost:3000/api/health"
    echo "📊 Redis: localhost:6379"
    echo ""
    echo "📝 Next steps:"
    echo "1. Edit .env file with your configuration"
    echo "2. Add Google Cloud credentials to credentials/ directory"
    echo "3. Configure your frontend to use http://localhost:3000"
    echo ""
}

# Cleanup function
cleanup() {
    print_status "Cleaning up..."
    docker-compose down
}

# Main execution
main() {
    # Set trap for cleanup
    trap cleanup EXIT
    
    # Parse command line arguments
    case "${1:-setup}" in
        "setup")
            check_docker
            check_docker_compose
            setup_env
            create_directories
            build_images
            start_services
            check_health
            show_status
            ;;
        "start")
            print_status "Starting services..."
            docker-compose up -d
            check_health
            ;;
        "stop")
            print_status "Stopping services..."
            docker-compose down
            ;;
        "restart")
            print_status "Restarting services..."
            docker-compose restart
            check_health
            ;;
        "logs")
            docker-compose logs -f
            ;;
        "clean")
            print_status "Cleaning up Docker resources..."
            docker-compose down -v
            docker system prune -f
            print_success "Cleanup completed"
            ;;
        "help")
            echo "Usage: $0 [command]"
            echo ""
            echo "Commands:"
            echo "  setup     # Complete setup (default)"
            echo "  start     # Start services"
            echo "  stop      # Stop services"
            echo "  restart   # Restart services"
            echo "  logs      # View logs"
            echo "  clean     # Clean up resources"
            echo "  help      # Show this help"
            ;;
        *)
            print_error "Unknown command: $1"
            print_status "Use '$0 help' for available commands"
            exit 1
            ;;
    esac
}

# Remove trap on successful completion
trap - EXIT

# Run main function
main "$@"