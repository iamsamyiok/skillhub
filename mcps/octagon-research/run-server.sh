#!/bin/bash

# Octagon Deep Research MCP Run Script

echo "Starting Octagon Deep Research MCP..."

# Check if the dist directory exists, if not, build the project
if [ ! -d "./dist" ]; then
    echo "Dist directory not found. Building project..."
    npm run build
fi

# Check if OCTAGON_API_KEY is set
if [ -z "$OCTAGON_API_KEY" ]; then
    # Try to load from .env file
    if [ -f ".env" ]; then
        export $(grep -v '^#' .env | xargs)
    fi
    
    # Check again if OCTAGON_API_KEY is set
    if [ -z "$OCTAGON_API_KEY" ]; then
        echo "Error: OCTAGON_API_KEY environment variable not set."
        echo "Please set your API key using: export OCTAGON_API_KEY=your_api_key"
        echo "Or create a .env file with OCTAGON_API_KEY=your_api_key"
        exit 1
    fi
fi

# Run the server
echo "Running server..."
node dist/index.js 